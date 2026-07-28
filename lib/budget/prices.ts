/**
 * Assumed list prices (USD per 1M tokens) used for spend estimates.
 * Override with env if provider pricing changes.
 *
 * Defaults approximate Anthropic Claude Sonnet 4.5 + OpenAI text-embedding-3-small
 * as of 2026 — not invoices; used only for soft daily ceilings.
 */

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const MODEL_PRICES = {
  /** claude-sonnet-4-5 via @ai-sdk/anthropic */
  chat: {
    model: "claude-sonnet-4-5",
    inputPer1M: () => readNumber("PRICE_CLAUDE_INPUT_PER_1M", 3),
    outputPer1M: () => readNumber("PRICE_CLAUDE_OUTPUT_PER_1M", 15),
  },
  /** text-embedding-3-small */
  embedding: {
    model: "text-embedding-3-small",
    inputPer1M: () => readNumber("PRICE_EMBEDDING_PER_1M", 0.02),
  },
} as const;

/** Rough token estimate when provider usage is unavailable (chars / 4). */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateTokensFromTexts(texts: string[]): number {
  return texts.reduce((sum, t) => sum + estimateTokensFromText(t), 0);
}

export function costForChatTokens(inputTokens: number, outputTokens: number): number {
  const input =
    (Math.max(0, inputTokens) / 1_000_000) * MODEL_PRICES.chat.inputPer1M();
  const output =
    (Math.max(0, outputTokens) / 1_000_000) * MODEL_PRICES.chat.outputPer1M();
  return input + output;
}

export function costForEmbeddingTokens(tokens: number): number {
  return (Math.max(0, tokens) / 1_000_000) * MODEL_PRICES.embedding.inputPer1M();
}

/** Pre-flight reserve for a typical chat turn (RAG + reply). */
export function chatReserveUsd(): number {
  return readNumber("BUDGET_CHAT_RESERVE_USD", 0.08);
}

/** Pre-flight reserve for structured research / onboarding LLM calls. */
export function researchReserveUsd(): number {
  return readNumber("BUDGET_RESEARCH_RESERVE_USD", 0.15);
}
