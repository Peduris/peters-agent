import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/client";
import {
  classifyVisitorInterest,
  shouldFlagInterest,
} from "@/lib/ai/interest";
import { escalateToAdmin } from "@/lib/ai/orchestrator";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import {
  ensureVisitorSession,
  flagVisitorInterest,
  getProfile,
  saveMessage,
} from "@/lib/db/queries";
import { hasAnthropic } from "@/lib/env";
import { formatHitsForPrompt, queryRag } from "@/lib/rag/vector";
import {
  chatReserveUsd,
  releaseReservation,
  settleChatSpend,
  tokensFromUsage,
  tryReserveSpend,
} from "@/lib/budget";
import { assertPublicRateLimits } from "@/lib/budget/rate-limit";
import { randomUUID } from "crypto";

export type PublicAskResult =
  | {
      ok: true;
      answer: string;
      sessionId: string;
      escalated?: boolean;
    }
  | {
      ok: false;
      error: string;
      code?: "missing_anthropic" | "budget_exceeded" | "rate_limited" | "ask_failed";
      retryAfterSeconds?: number;
    };

export type PublicProfileResult = {
  fullName: string | null;
  headline: string | null;
  publicBio: string | null;
};

function buildVisitorContext(
  profileBio: string | null | undefined,
  ragContext: string,
): string {
  const parts: string[] = [];
  if (profileBio?.trim()) {
    parts.push(`[public bio]\n${profileBio.trim()}`);
  }
  if (ragContext.trim()) {
    parts.push(ragContext.trim());
  }
  return parts.join("\n\n");
}

/**
 * Non-streaming Public Face ask — same RAG + escalate path as visitor chat.
 * Used by the public MCP tools.
 */
export async function askPetersAgent(input: {
  question: string;
  sessionId?: string | null;
  /** Client IP for public rate limits (MCP / proxy). */
  clientIp?: string | null;
}): Promise<PublicAskResult> {
  const question = input.question.trim();
  if (!question) {
    return { ok: false, error: "question is required", code: "ask_failed" };
  }

  if (!hasAnthropic()) {
    return {
      ok: false,
      error:
        "ANTHROPIC_API_KEY is missing. Add it to .env.local or Vercel env vars.",
      code: "missing_anthropic",
    };
  }

  const sessionId =
    typeof input.sessionId === "string" && input.sessionId.trim()
      ? input.sessionId.trim()
      : randomUUID();

  const rate = await assertPublicRateLimits({
    ip: input.clientIp?.trim() || "mcp",
    sessionId,
  });
  if (!rate.ok) {
    return {
      ok: false,
      error: rate.message,
      code: "rate_limited",
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  const reserveUsd = chatReserveUsd();
  const reserved = await tryReserveSpend("public", reserveUsd);
  if (!reserved.ok) {
    return {
      ok: false,
      error: reserved.message,
      code: "budget_exceeded",
    };
  }

  try {
    await ensureVisitorSession(sessionId);

    await saveMessage({
      surface: "visitor",
      agentId: "public-face",
      role: "user",
      content: question,
      sessionId,
    });

    const interest = classifyVisitorInterest(question);
    if (shouldFlagInterest(interest)) {
      await flagVisitorInterest(sessionId, interest);
    }

    const profile = await getProfile();
    const rag = await queryRag({
      query: question,
      topK: 6,
      visibility: "public",
    });
    const { context: ragContext, bestScore } = formatHitsForPrompt(
      rag.hits.map((h) => ({ text: h.text, score: h.score })),
      0.62,
    );

    const visitorContext = buildVisitorContext(profile?.public_bio, ragContext);
    const hasStrongRag = bestScore >= 0.62 && ragContext.trim().length > 0;
    const lowConfidence = !hasStrongRag;

    const systemBase = buildSystemPrompt({
      agentId: "public-face",
      surface: "visitor",
      profile,
      ragContext: visitorContext,
    });

    const system = lowConfidence
      ? `${systemBase}\n\n## Important\nPublic retrieval confidence is low for this question. If you cannot answer from the public bio / retrieved context, call escalateToPeter, then politely tell the visitor you will find out. Do not invent details.`
      : systemBase;

    let escalated = false;
    const model = getLanguageModel();
    const result = await generateText({
      model,
      system,
      messages: [{ role: "user", content: question }],
      stopWhen: stepCountIs(4),
      tools: {
        escalateToPeter: tool({
          description:
            "Escalate a factual question you cannot answer from public context to the public orchestrator → CEO/Peter admin queue. Call before telling the visitor you will check.",
          inputSchema: z.object({
            question: z.string().min(5),
            reason: z.string().optional(),
          }),
          execute: async ({ question: q, reason }) => {
            const out = await escalateToAdmin({
              question: q,
              visitorSessionId: sessionId,
              ragBestScore: bestScore,
              reason,
            });
            escalated = Boolean(out.ok);
            return {
              ...out,
              visitorGuidance:
                "Tell the visitor you'll check with Peter and get back to them. Do not invent an answer.",
            };
          },
        }),
      },
    });

    const answer = result.text?.trim() || "(No response generated.)";
    await saveMessage({
      surface: "visitor",
      agentId: "public-face",
      role: "assistant",
      content: answer,
      sessionId,
      metadata: { source: "mcp", escalated },
    });

    const usage = tokensFromUsage(result.usage);
    await settleChatSpend({
      surface: "public",
      reservedUsd: reserveUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    return { ok: true, answer, sessionId, escalated };
  } catch (error) {
    await releaseReservation("public", reserveUsd);
    const message =
      error instanceof Error ? error.message : "Public ask failed";
    console.error("[public-ask]", message);
    return { ok: false, error: message, code: "ask_failed" };
  }
}

export async function getPublicProfile(): Promise<PublicProfileResult> {
  const profile = await getProfile();
  return {
    fullName: profile?.full_name ?? "Peter",
    headline: profile?.headline ?? null,
    publicBio: profile?.public_bio ?? null,
  };
}
