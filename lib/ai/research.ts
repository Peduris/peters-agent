import { generateText, Output } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/client";
import { loadSkillMarkdown } from "@/lib/ai/agents";
import {
  createAgentRun,
  createPendingQuestion,
  getProfile,
  updateAgentRun,
  type Profile,
} from "@/lib/db/queries";
import { upsertChunks } from "@/lib/rag/vector";
import { hasAnthropic, hasOpenAI, hasUpstash } from "@/lib/env";

export const researchOutputSchema = z.object({
  focus: z.string(),
  findings: z.array(z.string()).min(3).max(12),
  gaps: z.array(z.string()).min(1).max(8),
  followUps: z.array(z.string()).min(1).max(3),
  reportMarkdown: z.string(),
  /** Market/public facts are safe to store; personal preference gaps need Peter. */
  storeWorthySummary: z
    .string()
    .describe(
      "Short markdown of market/public findings suitable for private RAG memory. Empty if nothing durable.",
    ),
  needsPeterInput: z
    .boolean()
    .describe(
      "True when personal preferences, goals, constraints, or private facts are still needed.",
    ),
});

export type ResearchOutput = z.infer<typeof researchOutputSchema>;

export type ResearchRunResult =
  | {
      ok: true;
      output: ResearchOutput;
      runId: string | null;
      ragUpserted: number;
      pendingQueued: number;
    }
  | { ok: false; error: string; runId: string | null };

function profileSnapshot(profile: Profile | null) {
  return {
    full_name: profile?.full_name,
    headline: profile?.headline,
    structured: profile?.structured,
    onboarding_answers: profile?.onboarding_answers,
    onboarding_questions: profile?.onboarding_questions,
  };
}

export async function runInternetResearch(input: {
  brief: string;
  kind?: string;
  /** Persist storeWorthySummary to Upstash (private). Default false — CEO decides. */
  persistRag?: boolean;
  /** Queue researcher follow-ups into pending_questions. Default false — CEO decides. */
  persistFollowUps?: boolean;
}): Promise<ResearchRunResult> {
  if (!hasAnthropic()) {
    return { ok: false, error: "ANTHROPIC_API_KEY missing", runId: null };
  }

  const brief = input.brief.trim();
  if (!brief) {
    return { ok: false, error: "Research brief is empty", runId: null };
  }

  const profile = await getProfile();
  const kind = input.kind ?? "on-demand-research";
  const skill = loadSkillMarkdown("internet-researcher");
  const runId = await createAgentRun({
    agentId: "internet-researcher",
    kind,
    status: "running",
    input: { brief, profileId: profile?.id ?? "peter" },
  });

  try {
    const { output } = await generateText({
      model: getLanguageModel(),
      output: Output.object({ schema: researchOutputSchema }),
      system: `${skill}

## On-demand research mode
You were delegated by the CEO for a specific brief. Produce structured findings.
Live web search may be unavailable — label uncertainty. Prefer actionable market/public signal over speculation.
Set needsPeterInput=true when Peter must supply personal preference, target role, location, constraints, or other private facts.
Put only durable market/public findings in storeWorthySummary (not personal guesses).`,
      prompt: `Research brief from CEO:
${brief}

Profile snapshot:
${JSON.stringify(profileSnapshot(profile), null, 2)}

Return focus, findings, gaps, 1-3 follow-up questions for Peter, reportMarkdown, storeWorthySummary, and needsPeterInput.`,
    });

    if (!output) {
      throw new Error("No structured research output");
    }

    let pendingQueued = 0;
    if (input.persistFollowUps) {
      for (const question of output.followUps) {
        const created = await createPendingQuestion({
          source: "internet-researcher",
          question,
          context: `Research focus: ${output.focus}`,
        });
        if (created) pendingQueued += 1;
      }
    }

    let ragUpserted = 0;
    const toStore = output.storeWorthySummary.trim() || output.reportMarkdown.trim();
    if (input.persistRag && toStore && hasUpstash() && hasOpenAI()) {
      const result = await upsertChunks([
        {
          id: `research-${Date.now()}`,
          text: toStore,
          visibility: "private",
          source: "internet-researcher",
          kind: "research-report",
          description: output.focus,
        },
      ]);
      ragUpserted = result.upserted;
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
          storeWorthySummary: output.storeWorthySummary,
          needsPeterInput: output.needsPeterInput,
          ragUpserted,
          pendingQueued,
        },
      });
    }

    return {
      ok: true,
      output,
      runId,
      ragUpserted,
      pendingQueued,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed";
    if (runId) {
      await updateAgentRun(runId, {
        status: "failed",
        error: message,
      });
    }
    return { ok: false, error: message, runId };
  }
}

export async function storeResearchInRag(input: {
  focus: string;
  summary: string;
}): Promise<{ ok: boolean; upserted: number; error?: string }> {
  const text = input.summary.trim();
  if (!text) {
    return { ok: false, upserted: 0, error: "Empty research summary" };
  }
  if (!hasUpstash() || !hasOpenAI()) {
    return {
      ok: false,
      upserted: 0,
      error: "Upstash Vector and OPENAI_API_KEY are required for RAG storage.",
    };
  }

  const result = await upsertChunks([
    {
      id: `research-${Date.now()}`,
      text,
      visibility: "private",
      source: "internet-researcher",
      kind: "research-report",
      description: input.focus,
    },
  ]);

  if (result.error) {
    return { ok: false, upserted: 0, error: result.error };
  }
  return { ok: true, upserted: result.upserted };
}
