import { Index } from "@upstash/vector";
import { env, hasUpstash } from "@/lib/env";
import { embedQuery, embedTexts } from "@/lib/rag/embeddings";

export type RagChunk = {
  id: string;
  text: string;
  visibility: "public" | "private";
  source?: string;
  kind?: string;
  documentId?: string;
  description?: string;
};

function getIndex() {
  if (!hasUpstash()) return null;
  return new Index({
    url: env.upstashVectorUrl()!,
    token: env.upstashVectorToken()!,
  });
}

export function chunkText(text: string, size = 800, overlap = 120): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + size);
    chunks.push(cleaned.slice(i, end));
    if (end >= cleaned.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

export async function upsertChunks(
  chunks: RagChunk[],
): Promise<{ upserted: number; error?: string }> {
  const index = getIndex();
  if (!index) {
    return { upserted: 0, error: "Upstash Vector is not configured." };
  }

  const embeddings = await embedTexts(chunks.map((c) => c.text));
  if (!embeddings) {
    return {
      upserted: 0,
      error: "OPENAI_API_KEY is required to embed chunks for Upstash.",
    };
  }

  await index.upsert(
    chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: embeddings[i],
      data: chunk.text,
      metadata: {
        visibility: chunk.visibility,
        source: chunk.source ?? "unknown",
        kind: chunk.kind ?? "document",
        text: chunk.text,
        ...(chunk.documentId ? { documentId: chunk.documentId } : {}),
        ...(chunk.description ? { description: chunk.description } : {}),
      },
    })),
  );

  return { upserted: chunks.length };
}

export async function deleteVectors(
  ids: string[],
): Promise<{ deleted: number; error?: string }> {
  const index = getIndex();
  if (!index) {
    return { deleted: 0, error: "Upstash Vector is not configured." };
  }
  if (ids.length === 0) return { deleted: 0 };

  // Upstash accepts batches; chunk to stay under request limits.
  const batchSize = 100;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    await index.delete(batch);
    deleted += batch.length;
  }
  return { deleted };
}

export async function queryRag(input: {
  query: string;
  topK?: number;
  visibility?: "public" | "private" | "any";
}): Promise<{ hits: Array<{ text: string; score: number; visibility: string }>; error?: string }> {
  const index = getIndex();
  if (!index) {
    return { hits: [], error: "Upstash Vector is not configured." };
  }

  const vector = await embedQuery(input.query);
  if (!vector) {
    return { hits: [], error: "OPENAI_API_KEY is required for RAG query embeddings." };
  }

  const result = await index.query({
    vector,
    topK: input.topK ?? 6,
    includeMetadata: true,
    includeData: true,
  });

  const visibility = input.visibility ?? "any";
  const hits = result
    .map((item) => {
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      const text =
        (typeof item.data === "string" && item.data) ||
        (typeof meta.text === "string" ? meta.text : "") ||
        "";
      return {
        text,
        score: item.score ?? 0,
        visibility: String(meta.visibility ?? "private"),
      };
    })
    .filter((hit) => {
      if (!hit.text) return false;
      if (visibility === "any") return true;
      return hit.visibility === visibility;
    });

  return { hits };
}

export function formatHitsForPrompt(
  hits: Array<{ text: string; score: number }>,
  minScore = 0.55,
): { context: string; bestScore: number } {
  const filtered = hits.filter((h) => h.score >= minScore);
  const bestScore = filtered[0]?.score ?? hits[0]?.score ?? 0;
  if (filtered.length === 0) {
    return { context: "", bestScore };
  }
  const context = filtered
    .map((h, i) => `[${i + 1}] (score=${h.score.toFixed(3)})\n${h.text}`)
    .join("\n\n");
  return { context, bestScore };
}
