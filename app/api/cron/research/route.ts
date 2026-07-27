import { generateText, Output } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/client";
import {
  createAgentRun,
  createPendingQuestion,
  getProfile,
  updateAgentRun,
} from "@/lib/db/queries";
import { upsertChunks } from "@/lib/rag/vector";
import { env, hasAnthropic, hasOpenAI, hasUpstash } from "@/lib/env";

export const maxDuration = 60;

function authorize(req: Request): boolean {
  const secret = env.cronSecret();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const header = req.headers.get("x-cron-secret");
  return header === secret;
}

async function runResearch() {
  if (!hasAnthropic()) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY missing",
    };
  }

  const profile = await getProfile();
  const runId = await createAgentRun({
    agentId: "internet-researcher",
    kind: "daily-market-scan",
    status: "running",
    input: { profileId: profile?.id ?? "peter" },
  });

  try {
    const { output } = await generateText({
      model: getLanguageModel(),
      output: Output.object({
        schema: z.object({
          focus: z.string(),
          findings: z.array(z.string()).min(3).max(12),
          gaps: z.array(z.string()).min(1).max(8),
          followUps: z.array(z.string()).min(1).max(3),
          reportMarkdown: z.string(),
        }),
      }),
      prompt: `You are Peter's Internet researcher running a daily job-market scan.
Use the profile snapshot below. Live web search may be unavailable — be explicit about uncertainty and focus on actionable gaps vs the profile.

Profile:
${JSON.stringify(
  {
    full_name: profile?.full_name,
    headline: profile?.headline,
    structured: profile?.structured,
    onboarding_answers: profile?.onboarding_answers,
    onboarding_questions: profile?.onboarding_questions,
  },
  null,
  2,
)}

Return focus, findings, gaps, 1-3 CEO follow-up questions, and a short markdown report.`,
    });

    if (!output) {
      throw new Error("No structured research output");
    }

    for (const question of output.followUps) {
      await createPendingQuestion({
        source: "internet-researcher",
        question,
        context: `Daily research focus: ${output.focus}`,
      });
    }

    if (hasUpstash() && hasOpenAI()) {
      await upsertChunks([
        {
          id: `research-${Date.now()}`,
          text: output.reportMarkdown,
          visibility: "private",
          source: "internet-researcher",
          kind: "research-report",
        },
      ]);
    }

    if (runId) {
      await updateAgentRun(runId, {
        status: "succeeded",
        output: {
          focus: output.focus,
          findings: output.findings,
          gaps: output.gaps,
          followUps: output.followUps,
          reportMarkdown: output.reportMarkdown,
        },
      });
    }

    return {
      ok: true,
      focus: output.focus,
      followUps: output.followUps,
      findingsCount: output.findings.length,
    };
  } catch (error) {
    if (runId) {
      await updateAgentRun(runId, {
        status: "failed",
        error: error instanceof Error ? error.message : "Research failed",
      });
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Research failed",
    };
  }
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runResearch();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(req: Request) {
  return GET(req);
}
