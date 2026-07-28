import {
  convertToModelMessages,
  streamText,
  tool,
  type UIMessage,
  stepCountIs,
} from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/client";
import { isAgentId, type AgentId } from "@/lib/ai/agent-meta";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { runInternetResearch, storeResearchInRag } from "@/lib/ai/research";
import {
  ADMIN_CEO_SESSION_ID,
  escalateToAdmin,
  formatOpenQueueForCeo,
  isDismissIntent,
  resolveAndDeliver,
} from "@/lib/ai/orchestrator";
import {
  createPendingQuestion,
  ensureVisitorSession,
  findAwaitingAdminEscalation,
  flagVisitorInterest,
  getProfile,
  listPendingQuestions,
  resolvePendingQuestion,
  saveMessage,
  updateProfile,
} from "@/lib/db/queries";
import { formatHitsForPrompt, queryRag } from "@/lib/rag/vector";
import { hasAnthropic } from "@/lib/env";
import {
  classifyVisitorInterest,
  shouldFlagInterest,
} from "@/lib/ai/interest";

export const maxDuration = 120;

function extractText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function buildVisitorContext(
  profileBio: string | null | undefined,
  ragContext: string,
): string {
  const parts: string[] = [];
  if (profileBio?.trim()) {
    parts.push(`[public bio]\n${profileBio.trim()}`);
  }
  if (ragContext.trim()) {
    parts.push(ragContext.trim());
  }
  return parts.join("\n\n");
}

export async function POST(req: Request) {
  if (!hasAnthropic()) {
    return Response.json(
      {
        error:
          "ANTHROPIC_API_KEY is missing. Add it to .env.local or Vercel env vars.",
      },
      { status: 503 },
    );
  }

  const body = await req.json();
  const messages = (body.messages ?? []) as UIMessage[];
  const surface = body.surface === "visitor" ? "visitor" : "admin";
  const visitorSessionId =
    typeof body.visitorSessionId === "string" && body.visitorSessionId.trim()
      ? body.visitorSessionId.trim()
      : null;

  let agentId: AgentId =
    typeof body.agentId === "string" && isAgentId(body.agentId)
      ? body.agentId
      : surface === "visitor"
        ? "public-face"
        : "ceo";

  if (surface === "visitor") {
    agentId = "public-face";
    if (visitorSessionId) {
      await ensureVisitorSession(visitorSessionId);
    }
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userText = lastUser ? extractText(lastUser) : "";

  const adminSessionId =
    surface === "admin" && agentId === "ceo" ? ADMIN_CEO_SESSION_ID : null;

  if (userText) {
    await saveMessage({
      surface,
      agentId,
      role: "user",
      content: userText,
      sessionId:
        surface === "visitor" ? visitorSessionId : adminSessionId,
    });

    // Flag high-signal visitor threads (recruiting / interview / etc.)
    if (surface === "visitor" && visitorSessionId) {
      const interest = classifyVisitorInterest(userText);
      if (shouldFlagInterest(interest)) {
        await flagVisitorInterest(visitorSessionId, interest);
      }
    }
  }

  // Primary path: Peter answers a visitor escalation directly in the CEO chat.
  if (surface === "admin" && agentId === "ceo" && userText) {
    const awaiting = await findAwaitingAdminEscalation(ADMIN_CEO_SESSION_ID);
    if (awaiting) {
      let confirmText: string;
      if (isDismissIntent(userText)) {
        await resolvePendingQuestion(awaiting.pendingId, "dismissed");
        confirmText = `Dismissed that visitor question (“${awaiting.question.slice(0, 120)}”).`;
        await saveMessage({
          surface: "admin",
          agentId: "ceo",
          role: "assistant",
          content: confirmText,
          sessionId: ADMIN_CEO_SESSION_ID,
          metadata: {
            kind: "visitor-escalation-dismissed",
            pendingId: awaiting.pendingId,
          },
        });
      } else {
        const delivered = await resolveAndDeliver({
          pendingId: awaiting.pendingId,
          answer: userText,
        });
        // resolveAndDeliver already wrote the durable confirm into the admin thread.
        confirmText = delivered.ok
          ? `Got it — stored and sent to the visitor.\n\nPublic reply:\n${delivered.publicReply}`
          : `I couldn’t deliver that reply (${delivered.error ?? "unknown error"}). Try again or use the secondary inbox.`;
        if (!delivered.ok) {
          await saveMessage({
            surface: "admin",
            agentId: "ceo",
            role: "assistant",
            content: confirmText,
            sessionId: ADMIN_CEO_SESSION_ID,
          });
        }
      }

      const model = getLanguageModel();
      const result = streamText({
        model,
        system: `Reply with exactly the following text and nothing else:\n\n${confirmText}`,
        messages: [{ role: "user", content: "ok" }],
      });
      return result.toUIMessageStreamResponse();
    }
  }

  const profile = await getProfile();
  const visibility = surface === "visitor" ? "public" : "any";
  const rag = userText
    ? await queryRag({ query: userText, topK: 6, visibility })
    : { hits: [] as Array<{ text: string; score: number; visibility: string }> };

  const { context: ragContext, bestScore } = formatHitsForPrompt(
    rag.hits.map((h) => ({ text: h.text, score: h.score })),
    surface === "visitor" ? 0.62 : 0.5,
  );

  const visitorContext =
    surface === "visitor"
      ? buildVisitorContext(profile?.public_bio, ragContext)
      : ragContext;

  // Knowledge known when RAG hits pass threshold OR public bio is present for bio-ish queries.
  const hasStrongRag = bestScore >= 0.62 && ragContext.trim().length > 0;
  const lowConfidence = surface === "visitor" && userText && !hasStrongRag;

  const openQueue =
    surface === "admin" && agentId === "ceo"
      ? await formatOpenQueueForCeo()
      : "";

  const system = buildSystemPrompt({
    agentId,
    surface,
    profile,
    ragContext: visitorContext,
    extraAdminBlock:
      openQueue &&
      `\n\n## Public orchestrator queue (open)\nAsk Peter about these visitor escalations when relevant. Use answerVisitorPending after Peter provides an answer.\n${openQueue}`,
  });

  const model = getLanguageModel();
  const modelMessages = await convertToModelMessages(messages);

  if (surface === "admin" && agentId === "ceo") {
    const result = streamText({
      model,
      system,
      messages: modelMessages,
      stopWhen: stepCountIs(6),
      tools: {
        delegateToInternetResearcher: tool({
          description:
            "Delegate a research brief to the internet-researcher specialist. Use for market/skills/job-trend questions. Returns structured findings; then store market facts and/or ask Peter about personal gaps.",
          inputSchema: z.object({
            brief: z
              .string()
              .min(10)
              .describe(
                "Concrete research brief: roles, skills, geography, or trend to investigate relative to Peter's profile.",
              ),
          }),
          execute: async ({ brief }) => {
            const research = await runInternetResearch({
              brief,
              kind: "ceo-delegation",
              persistRag: false,
              persistFollowUps: false,
            });
            if (!research.ok) {
              return { ok: false, error: research.error };
            }
            return {
              ok: true,
              runId: research.runId,
              focus: research.output.focus,
              findings: research.output.findings,
              gaps: research.output.gaps,
              followUps: research.output.followUps,
              reportMarkdown: research.output.reportMarkdown,
              storeWorthySummary: research.output.storeWorthySummary,
              needsPeterInput: research.output.needsPeterInput,
              guidance:
                "If storeWorthySummary is non-empty, call storeResearchFindings for market/public facts. If needsPeterInput or followUps matter, call queueFollowUpForPeter (and ask Peter in your reply).",
            };
          },
        }),
        storeResearchFindings: tool({
          description:
            "Persist useful market/public research into private RAG (Upstash) and append a short note on Peter's Neon profile.structured.research_notes.",
          inputSchema: z.object({
            focus: z.string(),
            summary: z.string().min(20),
            profileNote: z
              .string()
              .optional()
              .describe(
                "Optional short note to append under structured.research_notes",
              ),
          }),
          execute: async ({ focus, summary, profileNote }) => {
            const stored = await storeResearchInRag({ focus, summary });
            let profileUpdated = false;
            if (profileNote?.trim() || summary.trim()) {
              const current = await getProfile();
              const structured = {
                ...(current?.structured ?? {}),
              } as Record<string, unknown>;
              const existingNotes = Array.isArray(structured.research_notes)
                ? structured.research_notes.map(String)
                : [];
              const note =
                profileNote?.trim() ||
                `${focus}: ${summary.trim().slice(0, 280)}`;
              structured.research_notes = [...existingNotes, note].slice(-20);
              const updated = await updateProfile({ structured });
              profileUpdated = Boolean(updated);
            }
            return {
              ok: stored.ok || profileUpdated,
              ragUpserted: stored.upserted,
              ragError: stored.error,
              profileUpdated,
            };
          },
        }),
        queueFollowUpForPeter: tool({
          description:
            "Queue a follow-up question for Peter in the pending inbox. Prefer this when personal preference/facts are missing after research.",
          inputSchema: z.object({
            question: z.string(),
            context: z.string().optional(),
          }),
          execute: async ({ question, context: ctx }) => {
            const created = await createPendingQuestion({
              source: "ceo",
              question,
              context: ctx,
            });
            return created
              ? { ok: true, id: created.id }
              : { ok: false, error: "Could not persist pending question (Neon?)." };
          },
        }),
        listVisitorPending: tool({
          description:
            "List open visitor escalations from the public orchestrator queue.",
          inputSchema: z.object({}),
          execute: async () => {
            const items = await listPendingQuestions("open");
            return {
              ok: true,
              count: items.length,
              items: items.slice(0, 20).map((p) => ({
                id: p.id,
                source: p.source,
                question: p.question,
                visitorSessionId: p.visitor_session_id,
                createdAt: p.created_at,
              })),
            };
          },
        }),
        answerVisitorPending: tool({
          description:
            "After Peter answers a visitor escalation: store knowledge, reformulate a public reply, and deliver it to the correct visitor session via the public orchestrator.",
          inputSchema: z.object({
            pendingId: z.string().uuid(),
            answer: z.string().min(2),
            storePublicRag: z.boolean().optional(),
          }),
          execute: async ({ pendingId, answer, storePublicRag }) => {
            return resolveAndDeliver({
              pendingId,
              answer,
              storePublicRag,
            });
          },
        }),
        savePublicBio: tool({
          description: "Update Peter's public bio shown to visitors.",
          inputSchema: z.object({ bio: z.string().min(20) }),
          execute: async ({ bio }) => {
            const updated = await updateProfile({ public_bio: bio });
            return updated
              ? { ok: true }
              : { ok: false, error: "Profile update failed (Neon?)." };
          },
        }),
      },
      onFinish: async ({ text }) => {
        if (text) {
          await saveMessage({
            surface,
            agentId,
            role: "assistant",
            content: text,
            sessionId: ADMIN_CEO_SESSION_ID,
          });
        }
      },
    });

    return result.toUIMessageStreamResponse();
  }

  // Public Face: escalate unknowns via orchestrator (tool), not auto-on every weak score
  const visitorSystem =
    surface === "visitor" && lowConfidence
      ? `${system}\n\n## Important\nPublic retrieval confidence is low for this question. If you cannot answer from the public bio / retrieved context, call escalateToPeter, then politely tell the visitor you will find out. Do not invent details.`
      : system;

  if (surface === "visitor") {
    const sessionId = visitorSessionId;
    const result = streamText({
      model,
      system: visitorSystem,
      messages: modelMessages,
      stopWhen: stepCountIs(4),
      tools: {
        escalateToPeter: tool({
          description:
            "Escalate a factual question you cannot answer from public context to the public orchestrator → CEO/Peter admin queue. Call before telling the visitor you will check.",
          inputSchema: z.object({
            question: z.string().min(5),
            reason: z.string().optional(),
          }),
          execute: async ({ question, reason }) => {
            if (!sessionId) {
              return {
                ok: false,
                error: "Missing visitor session id",
              };
            }
            const escalated = await escalateToAdmin({
              question,
              visitorSessionId: sessionId,
              ragBestScore: bestScore,
              reason,
            });
            return {
              ...escalated,
              visitorGuidance:
                "Tell the visitor you'll check with Peter and get back to them. Do not invent an answer.",
            };
          },
        }),
      },
      onFinish: async ({ text }) => {
        if (text) {
          await saveMessage({
            surface,
            agentId,
            role: "assistant",
            content: text,
            sessionId,
          });
        }
      },
    });

    return result.toUIMessageStreamResponse();
  }

  const result = streamText({
    model,
    system,
    messages: modelMessages,
    onFinish: async ({ text }) => {
      if (text) {
        await saveMessage({
          surface,
          agentId,
          role: "assistant",
          content: text,
        });
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
