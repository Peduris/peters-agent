import { generateText } from "ai";
import { getLanguageModel } from "@/lib/ai/client";
import { loadSkillMarkdown } from "@/lib/ai/agents";
import {
  createPendingQuestion,
  findOpenPendingDuplicate,
  getPendingQuestion,
  listPendingQuestions,
  resolvePendingQuestion,
  saveMessage,
  touchVisitorSession,
  type PendingQuestion,
} from "@/lib/db/queries";
import { upsertChunks } from "@/lib/rag/vector";
import { hasAnthropic, hasOpenAI, hasUpstash } from "@/lib/env";

function isTrivialVisitorMessage(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 12) return true;
  return /^(hi|hello|hey|thanks|thank you|ok|okay|good morning|good evening)[\s!.?]*$/i.test(
    t,
  );
}

/** Escalate an unknown visitor question into the CEO/Peter admin queue. */
export async function escalateToAdmin(input: {
  question: string;
  visitorSessionId: string;
  ragBestScore?: number;
  reason?: string;
}): Promise<{ ok: boolean; pendingId?: string; duplicate?: boolean; skipped?: string }> {
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
    return { ok: true, pendingId: dup.id, duplicate: true };
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

  await touchVisitorSession(input.visitorSessionId, {
    preview: `Escalated: ${question.slice(0, 120)}`,
  });

  return { ok: true, pendingId: created.id };
}

async function formulatePublicReply(input: {
  question: string;
  answer: string;
}): Promise<string> {
  const fallback = input.answer.trim();
  if (!hasAnthropic()) return fallback;

  try {
    const skill = loadSkillMarkdown("public-orchestrator");
    const { text } = await generateText({
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
    return text.trim() || fallback;
  } catch {
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
    };
  }

  const publicReply = await formulatePublicReply({
    question: pending.question,
    answer,
  });

  let ragUpserted = 0;
  const storePublic = input.storePublicRag !== false;
  if (storePublic && hasUpstash() && hasOpenAI()) {
    const result = await upsertChunks([
      {
        id: `pending-answer-${pending.id}`,
        text: `Visitor question: ${pending.question}\nPublic answer: ${answer}`,
        visibility: "public",
        source: "pending-answer",
        kind: "faq",
      },
    ]);
    ragUpserted = result.upserted;
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

  return {
    ok: true,
    publicReply,
    visitorSessionId: sessionId,
    ragUpserted,
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
