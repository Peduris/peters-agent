import { generateText, Output } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/client";
import { getProfile, updateProfile } from "@/lib/db/queries";
import { upsertChunks } from "@/lib/rag/vector";
import { hasAnthropic, hasOpenAI, hasUpstash } from "@/lib/env";
import {
  BudgetExceededError,
  budgetExceededResponse,
  guardSpend,
  releaseReservation,
  researchReserveUsd,
  settleChatSpend,
  tokensFromUsage,
} from "@/lib/budget";

export async function POST(req: Request) {
  const body = await req.json();
  const answers = Array.isArray(body.answers)
    ? body.answers.map((a: unknown) => String(a ?? "").trim())
    : [];

  if (answers.length !== 5 || answers.some((a: string) => !a)) {
    return Response.json(
      { error: "Provide exactly 5 non-empty answers." },
      { status: 400 },
    );
  }

  const profile = await getProfile();
  const questions = profile?.onboarding_questions ?? [];

  let structured = profile?.structured ?? {};
  let publicBio = profile?.public_bio ?? undefined;
  let summary = "Answers saved.";

  if (hasAnthropic()) {
    const gated = await guardSpend({
      surface: "admin",
      reserveUsd: researchReserveUsd(),
    });
    if (!gated.ok) return gated.response;

    const qa = questions
      .map((q, i) => `Q${i + 1}: ${q}\nA${i + 1}: ${answers[i]}`)
      .join("\n\n");

    try {
      const { output, usage } = await generateText({
        model: getLanguageModel(),
        output: Output.object({
          schema: z.object({
            structured: z.record(z.string(), z.unknown()),
            publicBio: z.string(),
            summary: z.string(),
          }),
        }),
        prompt: `Merge these onboarding answers into Peter's profile.

Existing structured profile:
${JSON.stringify(structured, null, 2)}

Existing public bio:
${publicBio ?? "(none)"}

Q&A:
${qa}

Return updated structured fields, an improved visitor-safe publicBio, and a short summary for Peter.`,
      });

      const tokens = tokensFromUsage(usage);
      await settleChatSpend({
        surface: "admin",
        reservedUsd: gated.reserved,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
      });

      if (output) {
        structured = { ...structured, ...output.structured };
        publicBio = output.publicBio;
        summary = output.summary;
      }
    } catch (error) {
      await releaseReservation("admin", gated.reserved);
      if (error instanceof BudgetExceededError) {
        return budgetExceededResponse(error.message);
      }
      throw error;
    }
  }

  const updated = await updateProfile({
    structured,
    public_bio: publicBio,
    onboarding_answers: answers,
    onboarding_state: "complete",
  });

  if (publicBio && hasUpstash() && hasOpenAI()) {
    try {
      await upsertChunks(
        [
          {
            id: `public-bio-onboarding-${Date.now()}`,
            text: publicBio,
            visibility: "public",
            source: "onboarding",
            kind: "bio",
          },
        ],
        { surface: "admin" },
      );

      const privateNote = questions
        .map((q, i) => `${q}\n→ ${answers[i]}`)
        .join("\n\n");
      await upsertChunks(
        [
          {
            id: `onboarding-answers-${Date.now()}`,
            text: privateNote,
            visibility: "private",
            source: "onboarding",
            kind: "onboarding",
          },
        ],
        { surface: "admin" },
      );
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        return budgetExceededResponse(error.message);
      }
      throw error;
    }
  }

  return Response.json({
    ok: true,
    summary,
    profile: updated,
    onboardingState: "complete",
  });
}
