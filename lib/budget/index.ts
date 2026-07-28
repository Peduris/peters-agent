export type { SpendSurface } from "@/lib/budget/config";
export {
  budgetConfig,
  spendSurfaceFromChat,
} from "@/lib/budget/config";
export {
  MODEL_PRICES,
  chatReserveUsd,
  researchReserveUsd,
  costForChatTokens,
  costForEmbeddingTokens,
  estimateTokensFromText,
  estimateTokensFromTexts,
} from "@/lib/budget/prices";
export {
  getSpendSnapshot,
  tryReserveSpend,
  adjustSpend,
  recordSpend,
} from "@/lib/budget/spend";
export {
  assertPublicRateLimits,
  clientIpFromRequest,
} from "@/lib/budget/rate-limit";
export {
  BudgetExceededError,
  budgetExceededResponse,
  rateLimitedResponse,
  guardPublicChat,
  guardSpend,
  settleChatSpend,
  releaseReservation,
  chargeEmbedding,
  reserves,
  tokensFromUsage,
} from "@/lib/budget/guard";
