import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { env, hasOpenAI } from "@/lib/env";
import {
  BudgetExceededError,
  chargeEmbedding,
  type SpendSurface,
} from "@/lib/budget";

function getOpenAI() {
  const key = env.openaiApiKey();
  if (!key) return null;
  return createOpenAI({ apiKey: key });
}

export async function embedTexts(
  texts: string[],
  opts?: { surface?: SpendSurface },
): Promise<number[][] | null> {
  if (!hasOpenAI() || texts.length === 0) return null;
  const openai = getOpenAI();
  if (!openai) return null;

  if (opts?.surface) {
    await chargeEmbedding({ surface: opts.surface, texts });
  }

  const { embeddings } = await embedMany({
    model: openai.embedding("text-embedding-3-small"),
    values: texts,
  });
  return embeddings;
}

export async function embedQuery(
  text: string,
  opts?: { surface?: SpendSurface },
): Promise<number[] | null> {
  if (!hasOpenAI()) return null;
  const openai = getOpenAI();
  if (!openai) return null;

  if (opts?.surface) {
    await chargeEmbedding({ surface: opts.surface, texts: [text] });
  }

  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: text,
  });
  return embedding;
}

export { BudgetExceededError };
