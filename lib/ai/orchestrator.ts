import { generateText } from "ai";
import { getLanguageModel } from "@/lib/ai/client";
import { loadSkillMarkdown } from "@/lib/ai/agents";
import {
  createPendingQuestion,
  findOpenPendingDuplicate,
  flagVisitorInterest,
  getPendingQuestion,
  listPendingQuestions,
  resolvePendingQuestion,
  saveMessage,
  touchVisitorSession,
  type PendingQuestion,
} from "@/lib/db/queries";
import { upsertChunks } from "@/lib/rag/vector";
import { hasAnthropic, hasOpenAI, hasUpstash } from "@/lib/env";
import { ADMIN_CEO_SESSION_ID } from "@/lib/ai/session-ids";
import {
  classifyVisitorInterest,
  shouldFlagInterest,
} from "@/lib/ai/interest";
import {
  BudgetExceededError,
  guardSpend,
  releaseReservation,
  researchReserveUsd,
  settleChatSpend,
  tokensFromUsage,
} from "@/lib/budget";

export { ADMIN_CEO_SESSION_ID } from "@/lib/ai/session-ids";

function isTrivialVisitorMessage(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 12) return true;
  return /^(hi|hello|hey|thanks|thank you|ok|okay|good morning|good evening)[\s!.?]*$/i.test(
    t,
  );
}

function ceoEscalationPrompt(input: {
  question: string;
  pendingId: string;
  visitorSessionId: string;
}): string {
  const shortSession = input.visitorSessionId.slice(0, 8);
  return `A visitor asked (session ${shortSession}…):\n\n"${input.question}"\n\nWhat should I tell them? Reply here in chat and I’ll store it and send a public-facing reply back to that visitor.`;
}

/** Escalate an unknown visitor question into the CEO/Peter admin chat thread. */
export async function escalateToAdmin(input: {
  question: string;
  visitorSessionId: string;
  ragBestScore?: number;
  reason?: string;
}): Promise<{
  ok: boolean;
  pendingId?: string;
  duplicate?: boolean;
  skipped?: string;
  adminMessagePosted?: boolean;
}> {
  const question = input.question.trim();
  if (!question) return { ok: false, skipped: "empty" };
  if (isTrivialVisitorMessage(question)) {
    return { ok: false, skipped: "trivial" };
  }

  const dup = await findOpenPendingDuplicate({
    question,
    visitorSessionId: input.visitorSessionId,
    withinMinutes: 180,
  });
  if (dup) {
    await touchVisitorSession(input.visitorSessionId, {});
    // Nudge again in admin chat if still open
    await saveMessage({
      surface: "admin",
      agentId: "ceo",
      role: "assistant",
      content: ceoEscalationPrompt({
        question: dup.question,
        pendingId: dup.id,
        visitorSessionId: input.visitorSessionId,
      }),
      sessionId: ADMIN_CEO_SESSION_ID,
      metadata: {
        kind: "visitor-escalation",
        pendingId: dup.id,
        visitorSessionId: input.visitorSessionId,
        duplicate: true,
      },
    });
    return {
      ok: true,
      pendingId: dup.id,
      duplicate: true,
      adminMessagePosted: true,
    };
  }

  const scoreNote =
    typeof input.ragBestScore === "number"
      ? ` RAG bestScore=${input.ragBestScore.toFixed(3)}.`
      : "";
  const created = await createPendingQuestion({
    source: "public-orchestrator",
    question,
    context:
      (input.reason?.trim() ||
        "Public Face could not answer from public memory.") + scoreNote,
    visitorSessionId: input.visitorSessionId,
    metadata: {
      routedBy: "public-orchestrator",
      escalatedAt: new Date().toISOString(),
    },
  });

  if (!created) return { ok: false, skipped: "persist-failed" };

  const interest = classifyVisitorInterest(question);
  if (shouldFlagInterest(interest)) {
    await flagVisitorInterest(input.visitorSessionId, interest);
  }

  await touchVisitorSession(input.visitorSessionId, {
    preview: `Escalated: ${question.slice(0, 120)}`,
  });

  await saveMessage({
    surface: "admin",
    agentId: "ceo",
    role: "assistant",
    content: ceoEscalationPrompt({
      question,
      pendingId: created.id,
      visitorSessionId: input.visitorSessionId,
    }),
    sessionId: ADMIN_CEO_SESSION_ID,
    metadata: {
      kind: "visitor-escalation",
      pendingId: created.id,
      visitorSessionId: input.visitorSessionId,
    },
  });

  return {
    ok: true,
    pendingId: created.id,
    adminMessagePosted: true,
  };
}

async function formulatePublicReply(input: {
  question: string;
  answer: string;
}): Promise<string> {
  const fallback = input.answer.trim();
  if (!hasAnthropic()) return fallback;

  const gated = await guardSpend({
    surface: "admin",
    reserveUsd: researchReserveUsd(),
  });
  if (!gated.ok) return fallback;

  try {
    const skill = loadSkillMarkdown("public-orchestrator");
    const { text, usage } = await generateText({
      model: getLanguageModel(),
      system: `${skill}

You reformulate Peter's internal answer into a short visitor-facing reply from Peter's Agent (Public Face voice). Warm, concise, no internal jargon, no mention of admin/CEO/orchestrator.`,
      prompt: `Visitor asked:
"""
${input.question}
"""

Peter's answer (source of truth):
"""
${input.answer}
"""

Write the public reply only.`,
    });
    const tokens = tokensFromUsage(usage);
    await settleChatSpend({
      surface: "admin",
      reservedUsd: gated.reserved,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
    });
    return text.trim() || fallback;
  } catch {
    await releaseReservation("admin", gated.reserved);
    return fallback;
  }
}

/** Resolve a pending question: store knowledge, reformulate, deliver into the visitor session. */
export async function resolveAndDeliver(input: {
  pendingId: string;
  answer: string;
  storePublicRag?: boolean;
}): Promise<{
  ok: boolean;
  error?: string;
  publicReply?: string;
  visitorSessionId?: string | null;
  ragUpserted?: number;
  question?: string;
}> {
  const answer = input.answer.trim();
  if (!answer) return { ok: false, error: "Answer is required" };

  const pending = await getPendingQuestion(input.pendingId);
  if (!pending) return { ok: false, error: "Pending question not found" };
  if (pending.status !== "open") {
    return {
      ok: true,
      publicReply: pending.public_reply ?? undefined,
      visitorSessionId: pending.visitor_session_id,
      question: pending.question,
    };
  }

  const publicReply = await formulatePublicReply({
    question: pending.question,
    answer,
  });

  let ragUpserted = 0;
  const storePublic = input.storePublicRag !== false;
  if (storePublic && hasUpstash() && hasOpenAI()) {
    try {
      const result = await upsertChunks(
        [
          {
            id: `pending-answer-${pending.id}`,
            text: `Visitor question: ${pending.question}\nPublic answer: ${answer}`,
            visibility: "public",
            source: "pending-answer",
            kind: "faq",
          },
        ],
        { surface: "admin" },
      );
      ragUpserted = result.upserted;
    } catch (error) {
      if (!(error instanceof BudgetExceededError)) throw error;
      // Budget exhausted — still deliver the reply without RAG write.
    }
  }

  const ok = await resolvePendingQuestion(input.pendingId, "answered", answer, {
    publicReply,
    metadata: {
      resolvedBy: "public-orchestrator",
      ragUpserted,
      storePublicRag: storePublic,
    },
  });
  if (!ok) return { ok: false, error: "Could not resolve pending question" };

  const sessionId = pending.visitor_session_id;
  if (sessionId) {
    await saveMessage({
      surface: "visitor",
      agentId: "public-face",
      role: "assistant",
      content: publicReply,
      sessionId,
      metadata: {
        kind: "orchestrator-delivery",
        pendingId: pending.id,
      },
    });
    await touchVisitorSession(sessionId, {
      preview: publicReply.slice(0, 160),
      bumpMessages: true,
    });
  }

  // Confirm in admin CEO thread
  await saveMessage({
    surface: "admin",
    agentId: "ceo",
    role: "assistant",
    content: `Delivered to the visitor${sessionId ? ` (${sessionId.slice(0, 8)}…)` : ""}.\n\nPublic reply:\n${publicReply}${ragUpserted ? `\n\n(Also stored in public RAG for next time.)` : ""}`,
    sessionId: ADMIN_CEO_SESSION_ID,
    metadata: {
      kind: "visitor-delivery-confirm",
      pendingId: pending.id,
      visitorSessionId: sessionId,
    },
  });

  return {
    ok: true,
    publicReply,
    visitorSessionId: sessionId,
    ragUpserted,
    question: pending.question,
  };
}

export async function formatOpenQueueForCeo(): Promise<string> {
  const open = await listPendingQuestions("open");
  if (open.length === 0) return "(No open pending questions.)";
  return open
    .slice(0, 12)
    .map((p: PendingQuestion, i: number) => {
      const sid = p.visitor_session_id
        ? ` session=${p.visitor_session_id.slice(0, 8)}…`
        : "";
      return `${i + 1}. [${p.id.slice(0, 8)}] (${p.source}${sid}) ${p.question}`;
    })
    .join("\n");
}

export function isDismissIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(dismiss|skip|ignore|don'?t answer|no need)(\s|$)/i.test(t);
}
