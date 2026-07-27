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
import {
  createPendingQuestion,
  getProfile,
  saveMessage,
  updateProfile,
} from "@/lib/db/queries";
import { formatHitsForPrompt, queryRag } from "@/lib/rag/vector";
import { hasAnthropic } from "@/lib/env";

export const maxDuration = 60;

function extractText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
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
  let agentId: AgentId =
    typeof body.agentId === "string" && isAgentId(body.agentId)
      ? body.agentId
      : surface === "visitor"
        ? "public-face"
        : "ceo";

  if (surface === "visitor") {
    agentId = "public-face";
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userText = lastUser ? extractText(lastUser) : "";

  if (userText) {
    await saveMessage({
      surface,
      agentId,
      role: "user",
      content: userText,
    });
  }

  const profile = await getProfile();
  const visibility = surface === "visitor" ? "public" : "any";
  const rag = userText
    ? await queryRag({ query: userText, topK: 6, visibility })
    : { hits: [] as Array<{ text: string; score: number; visibility: string }> };

  const { context, bestScore } = formatHitsForPrompt(
    rag.hits.map((h) => ({ text: h.text, score: h.score })),
    surface === "visitor" ? 0.62 : 0.5,
  );

  // Visitor escalation when RAG is weak
  if (surface === "visitor" && userText && bestScore < 0.62) {
    await createPendingQuestion({
      source: "public-face",
      question: userText,
      context: `Low RAG confidence (bestScore=${bestScore.toFixed(3)}). Visitor asked something Public Face could not answer from public memory.`,
    });
  }

  const system = buildSystemPrompt({
    agentId,
    surface,
    profile,
    ragContext: context,
  });

  const model = getLanguageModel();
  const modelMessages = await convertToModelMessages(messages);

  if (surface === "admin" && agentId === "ceo") {
    const result = streamText({
      model,
      system,
      messages: modelMessages,
      stopWhen: stepCountIs(3),
      tools: {
        queueFollowUpForPeter: tool({
          description:
            "Queue a follow-up question for Peter in the pending inbox.",
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
          });
        }
      },
    });

    return result.toUIMessageStreamResponse();
  }

  // Public face: if low confidence, bias the model toward deferral
  const visitorSystem =
    surface === "visitor" && bestScore < 0.62
      ? `${system}\n\n## Important\nPublic retrieval confidence is low. Politely say you do not have that information available and that you will check with Peter. Do not invent details.`
      : system;

  const result = streamText({
    model,
    system: visitorSystem,
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
