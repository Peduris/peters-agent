import { generateText, Output } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/client";
import { saveDocument, updateProfile, getProfile } from "@/lib/db/queries";
import { extractPdfText } from "@/lib/pdf/extract";
import { chunkText, upsertChunks, type RagChunk } from "@/lib/rag/vector";
import { hasAnthropic, hasOpenAI, hasUpstash, hasNeon } from "@/lib/env";
import {
  BudgetExceededError,
  budgetExceededResponse,
  guardSpend,
  releaseReservation,
  researchReserveUsd,
  settleChatSpend,
  tokensFromUsage,
} from "@/lib/budget";

/** PDF.js / unpdf need Node APIs — not Edge. */
export const runtime = "nodejs";
export const maxDuration = 60;

const KINDS = new Set(["cv", "project", "note", "other"]);

async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    file.type.startsWith("text/")
  ) {
    return buf.toString("utf8");
  }

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    try {
      return await extractPdfText(buf);
    } catch (error) {
      throw new Error(
        `Could not parse PDF (${error instanceof Error ? error.message : "unknown error"}). Try uploading a .txt or .md export.`,
      );
    }
  }

  // Fallback: attempt utf8
  const asText = buf.toString("utf8");
  if (asText.replace(/\u0000/g, "").trim().length > 40) return asText;
  throw new Error("Unsupported file type. Upload PDF, TXT, or Markdown.");
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Missing file" }, { status: 400 });
    }

    const rawKind = String(form.get("kind") ?? "other").toLowerCase();
    const kind = KINDS.has(rawKind) ? rawKind : "other";
    const description = String(form.get("description") ?? "").trim();
    const runOnboarding =
      kind === "cv" && String(form.get("onboarding") ?? "true") !== "false";

    const contentText = (await extractTextFromFile(file)).trim();
    if (contentText.length < 40) {
      return Response.json(
        { error: "File content too short to ingest." },
        { status: 400 },
      );
    }

    const documentId = crypto.randomUUID();
    const chunks = chunkText(contentText);
    const ragChunks: RagChunk[] = chunks.map((text, i) => ({
      id: `doc-${documentId}-${i}`,
      text,
      visibility: "private" as const,
      source: file.name,
      kind,
      documentId,
      description: description || undefined,
    }));

    if (description) {
      ragChunks.unshift({
        id: `doc-${documentId}-desc`,
        text: `Upload description (${file.name}): ${description}`,
        visibility: "private",
        source: file.name,
        kind,
        documentId,
        description,
      });
    }

    const vectorIds = ragChunks.map((c) => c.id);

    let upserted = 0;
    let ragError: string | undefined;
    if (hasUpstash() && hasOpenAI()) {
      try {
        const result = await upsertChunks(ragChunks, { surface: "admin" });
        upserted = result.upserted;
        ragError = result.error;
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return budgetExceededResponse(error.message);
        }
        throw error;
      }
    } else {
      const need: string[] = [];
      if (!hasUpstash()) need.push("UPSTASH_VECTOR_REST_URL/TOKEN");
      if (!hasOpenAI()) need.push("OPENAI_API_KEY");
      ragError = `Skipping vector upsert — missing ${need.join(" and ")}.`;
    }

    let savedId: string | null = null;
    if (hasNeon()) {
      const saved = await saveDocument({
        id: documentId,
        filename: file.name,
        mimeType: file.type,
        contentText,
        chunkCount: chunks.length,
        kind,
        description: description || null,
        vectorIds,
        metadata: {
          ingestAt: new Date().toISOString(),
          hasDescription: Boolean(description),
        },
      });
      if ("id" in saved) savedId = saved.id;
      else {
        return Response.json({ error: saved.error }, { status: 503 });
      }
    }

    let questions: string[] = [];
    let publicBio: string | undefined;
    let structured: Record<string, unknown> | undefined;

    // Non-onboarding CV uploads still enrich structured profile when Anthropic is available.
    if (!runOnboarding && kind === "cv" && hasAnthropic()) {
      try {
        const gated = await guardSpend({
          surface: "admin",
          reserveUsd: researchReserveUsd(),
        });
        if (!gated.ok) {
          // Skip enrichment when budget exhausted; document already saved.
        } else {
          try {
            const { output, usage } = await generateText({
              model: getLanguageModel(),
              output: Output.object({
                schema: z.object({
                  structured: z.object({
                    skills: z.array(z.string()).default([]),
                    roles: z.array(z.string()).default([]),
                    industries: z.array(z.string()).default([]),
                    locations: z.array(z.string()).default([]),
                    languages: z.array(z.string()).default([]),
                    highlights: z.array(z.string()).default([]),
                  }),
                  publicBio: z.string().optional(),
                }),
              }),
              prompt: `Parse this CV into structured profile fields for Peter.
Return skills, roles, industries, locations, languages, highlights.
Optionally improve a visitor-safe publicBio (2-4 sentences, no private contacts).

${description ? `Uploader note: ${description}\n` : ""}
CV:
"""
${contentText.slice(0, 24000)}
"""`,
            });
            const tokens = tokensFromUsage(usage);
            await settleChatSpend({
              surface: "admin",
              reservedUsd: gated.reserved,
              inputTokens: tokens.inputTokens,
              outputTokens: tokens.outputTokens,
            });
            if (output) {
              const existing = await getProfile();
              await updateProfile({
                structured: {
                  ...(existing?.structured ?? {}),
                  ...output.structured,
                  lastCvFilename: file.name,
                  lastCvIngestedAt: new Date().toISOString(),
                },
                public_bio: output.publicBio,
              });
            }
          } catch {
            await releaseReservation("admin", gated.reserved);
            // Profile enrichment is best-effort for library uploads
          }
        }
      } catch {
        // Profile enrichment is best-effort for library uploads
      }
    }

    if (runOnboarding && hasAnthropic()) {
      const gated = await guardSpend({
        surface: "admin",
        reserveUsd: researchReserveUsd(),
      });
      if (!gated.ok) {
        return gated.response;
      }
      try {
        const { output, usage } = await generateText({
          model: getLanguageModel(),
          output: Output.object({
            schema: z.object({
              structured: z.object({
                skills: z.array(z.string()).default([]),
                roles: z.array(z.string()).default([]),
                industries: z.array(z.string()).default([]),
                locations: z.array(z.string()).default([]),
                languages: z.array(z.string()).default([]),
                highlights: z.array(z.string()).default([]),
              }),
              publicBio: z.string(),
              questions: z.array(z.string()).length(5),
            }),
          }),
          prompt: `You are Peter's Data storage + CEO onboarding helper.
Parse this CV text and return:
- structured profile fields
- a visitor-safe publicBio (2-4 sentences, no private contacts/salary)
- exactly 5 high-leverage follow-up questions for Peter to refine the agent memory

${description ? `Uploader note: ${description}\n` : ""}
CV:
"""
${contentText.slice(0, 24000)}
"""`,
        });
        const tokens = tokensFromUsage(usage);
        await settleChatSpend({
          surface: "admin",
          reservedUsd: gated.reserved,
          inputTokens: tokens.inputTokens,
          outputTokens: tokens.outputTokens,
        });

        if (output) {
          structured = output.structured;
          publicBio = output.publicBio;
          questions = output.questions;
        }
      } catch (error) {
        await releaseReservation("admin", gated.reserved);
        if (error instanceof BudgetExceededError) {
          return budgetExceededResponse(error.message);
        }
        throw error;
      }
    } else if (runOnboarding) {
      questions = [
        "What roles are you targeting in the next 6–12 months?",
        "Which skills do you want to emphasize publicly vs keep private?",
        "What industries or company stages interest you most?",
        "Any constraints (location, language, schedule) the agent should know?",
        "What should Peter's Agent never share with visitors?",
      ];
    }

    if (runOnboarding) {
      const existing = await getProfile();
      const mergedStructured = {
        ...(existing?.structured ?? {}),
        ...(structured ?? {}),
        lastCvFilename: file.name,
        lastCvIngestedAt: new Date().toISOString(),
      };

      await updateProfile({
        structured: mergedStructured,
        public_bio: publicBio,
        onboarding_state: "questions_asked",
        onboarding_questions: questions,
        onboarding_answers: [],
      });

      if (publicBio && hasUpstash() && hasOpenAI()) {
        try {
          await upsertChunks(
            [
              {
                id: `public-bio-${documentId}`,
                text: publicBio,
                visibility: "public",
                source: "public-bio",
                kind: "bio",
                documentId,
              },
            ],
            { surface: "admin" },
          );
        } catch (error) {
          if (!(error instanceof BudgetExceededError)) throw error;
        }
      }
    }

    return Response.json({
      ok: true,
      documentId: savedId ?? documentId,
      kind,
      description: description || null,
      chunkCount: chunks.length,
      vectorCount: vectorIds.length,
      upserted,
      ragError,
      questions: runOnboarding ? questions : undefined,
      publicBio: runOnboarding ? publicBio : undefined,
      onboardingState: runOnboarding ? "questions_asked" : undefined,
      warnings: [
        !hasNeon() ? "DATABASE_URL missing — document not persisted to Neon." : null,
        ragError ?? null,
      ].filter(Boolean),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Ingest failed",
      },
      { status: 500 },
    );
  }
}
