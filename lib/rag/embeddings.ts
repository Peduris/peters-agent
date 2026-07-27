import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { env, hasOpenAI } from "@/lib/env";

function getOpenAI() {
  const key = env.openaiApiKey();
  if (!key) return null;
  return createOpenAI({ apiKey: key });
}

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!hasOpenAI() || texts.length === 0) return null;
  const openai = getOpenAI();
  if (!openai) return null;

  const { embeddings } = await embedMany({
    model: openai.embedding("text-embedding-3-small"),
    values: texts,
  });
  return embeddings;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  if (!hasOpenAI()) return null;
  const openai = getOpenAI();
  if (!openai) return null;

  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: text,
  });
  return embedding;
}
