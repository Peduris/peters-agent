import { generateText, Output } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/client";
import { saveDocument, updateProfile, getProfile } from "@/lib/db/queries";
import { chunkText, upsertChunks } from "@/lib/rag/vector";
import { hasAnthropic, hasOpenAI, hasUpstash, hasNeon } from "@/lib/env";

export const maxDuration = 60;

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
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      const parsed = await parser.getText();
      await parser.destroy();
      return parsed.text || "";
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

    const contentText = (await extractTextFromFile(file)).trim();
    if (contentText.length < 40) {
      return Response.json(
        { error: "File content too short to ingest." },
        { status: 400 },
      );
    }

    const chunks = chunkText(contentText);
    const stamp = Date.now();
    const ragChunks = chunks.map((text, i) => ({
      id: `cv-${stamp}-${i}`,
      text,
      visibility: "private" as const,
      source: file.name,
      kind: "cv",
    }));

    // Also upsert a smaller public-safe summary chunk later after model rewrite
    let upserted = 0;
    let ragError: string | undefined;
    if (hasUpstash() && hasOpenAI()) {
      const result = await upsertChunks(ragChunks);
      upserted = result.upserted;
      ragError = result.error;
    } else {
      ragError =
        "Skipping vector upsert — need UPSTASH_VECTOR_* and OPENAI_API_KEY.";
    }

    let documentId: string | null = null;
    if (hasNeon()) {
      const saved = await saveDocument({
        filename: file.name,
        mimeType: file.type,
        contentText,
        chunkCount: chunks.length,
        kind: "cv",
      });
      if ("id" in saved) documentId = saved.id;
    }

    let questions: string[] = [];
    let publicBio: string | undefined;
    let structured: Record<string, unknown> | undefined;

    if (hasAnthropic()) {
      const { output } = await generateText({
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

CV:
"""
${contentText.slice(0, 24000)}
"""`,
      });

      if (output) {
        structured = output.structured;
        publicBio = output.publicBio;
        questions = output.questions;
      }
    } else {
      questions = [
        "What roles are you targeting in the next 6–12 months?",
        "Which skills do you want to emphasize publicly vs keep private?",
        "What industries or company stages interest you most?",
        "Any constraints (location, language, schedule) the agent should know?",
        "What should Peter's Agent never share with visitors?",
      ];
    }

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

    // Public bio into public RAG slice
    if (publicBio && hasUpstash() && hasOpenAI()) {
      await upsertChunks([
        {
          id: `public-bio-${stamp}`,
          text: publicBio,
          visibility: "public",
          source: "public-bio",
          kind: "bio",
        },
      ]);
    }

    return Response.json({
      ok: true,
      documentId,
      chunkCount: chunks.length,
      upserted,
      ragError,
      questions,
      publicBio,
      onboardingState: "questions_asked",
      warnings: [
        !hasNeon() ? "DATABASE_URL missing — profile not persisted to Neon." : null,
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
