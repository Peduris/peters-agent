import type { SpendSurface } from "@/lib/budget/config";
import {
  adjustSpend,
  tryReserveSpend,
  type ReserveResult,
} from "@/lib/budget/spend";
import { assertPublicRateLimits, clientIpFromRequest } from "@/lib/budget/rate-limit";
import {
  chatReserveUsd,
  costForChatTokens,
  costForEmbeddingTokens,
  estimateTokensFromTexts,
  researchReserveUsd,
} from "@/lib/budget/prices";

export class BudgetExceededError extends Error {
  status = 429;
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export function budgetExceededResponse(
  message: string,
  retryAfterSeconds = 3600,
): Response {
  return Response.json(
    {
      error: message,
      code: "budget_exceeded",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, retryAfterSeconds)),
      },
    },
  );
}

export function rateLimitedResponse(
  message: string,
  retryAfterSeconds: number,
): Response {
  return Response.json(
    {
      error: message,
      code: "rate_limited",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, retryAfterSeconds)),
      },
    },
  );
}

/**
 * Guard public chat: soft IP/session rate limits, then reserve from the
 * shared global daily pool.
 */
export async function guardPublicChat(input: {
  req: Request;
  sessionId?: string | null;
  reserveUsd?: number;
}): Promise<
  | { ok: true; reserved: number; surface: "public" }
  | { ok: false; response: Response }
> {
  const ip = clientIpFromRequest(input.req);
  const rate = await assertPublicRateLimits({
    ip,
    sessionId: input.sessionId,
  });
  if (!rate.ok) {
    return {
      ok: false,
      response: rateLimitedResponse(rate.message, rate.retryAfterSeconds),
    };
  }

  const reserved = input.reserveUsd ?? chatReserveUsd();
  const result = await tryReserveSpend("public", reserved);
  if (!result.ok) {
    return {
      ok: false,
      response: budgetExceededResponse(result.message),
    };
  }
  return { ok: true, reserved, surface: "public" };
}

/** Reserve against the shared global pool (any surface attribution). */
export async function guardSpend(input: {
  surface: SpendSurface;
  reserveUsd: number;
}): Promise<
  | { ok: true; reserved: number }
  | { ok: false; response: Response; result: ReserveResult }
> {
  const result = await tryReserveSpend(input.surface, input.reserveUsd);
  if (!result.ok) {
    return {
      ok: false,
      response: budgetExceededResponse(result.message),
      result,
    };
  }
  return { ok: true, reserved: input.reserveUsd };
}

export async function settleChatSpend(input: {
  surface: SpendSurface;
  reservedUsd: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): Promise<void> {
  const inputTokens = Number(input.inputTokens ?? 0);
  const outputTokens = Number(input.outputTokens ?? 0);
  const actual =
    inputTokens + outputTokens > 0
      ? costForChatTokens(inputTokens, outputTokens)
      : input.reservedUsd;
  await adjustSpend(input.surface, actual - input.reservedUsd);
}

export async function releaseReservation(
  surface: SpendSurface,
  reservedUsd: number,
): Promise<void> {
  if (reservedUsd > 0) {
    await adjustSpend(surface, -reservedUsd);
  }
}

/** Check+record embedding cost against the shared pool. */
export async function chargeEmbedding(input: {
  surface: SpendSurface;
  texts: string[];
}): Promise<number> {
  const tokens = estimateTokensFromTexts(input.texts);
  const cost = costForEmbeddingTokens(tokens);
  if (cost <= 0) return 0;
  const result = await tryReserveSpend(input.surface, Math.max(cost, 0.000001));
  if (!result.ok) {
    throw new BudgetExceededError(result.message);
  }
  return cost;
}

export function reserves() {
  return {
    chat: chatReserveUsd(),
    research: researchReserveUsd(),
  };
}

/** Extract token usage from AI SDK finish/result shapes. */
export function tokensFromUsage(usage: unknown): {
  inputTokens: number;
  outputTokens: number;
} {
  if (!usage || typeof usage !== "object") {
    return { inputTokens: 0, outputTokens: 0 };
  }
  const u = usage as Record<string, unknown>;
  const inputTokens = Number(
    u.inputTokens ?? u.promptTokens ?? u.input_tokens ?? 0,
  );
  const outputTokens = Number(
    u.outputTokens ?? u.completionTokens ?? u.output_tokens ?? 0,
  );
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  };
}
