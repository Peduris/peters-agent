import { listMessagesAfter, listSessionMessages } from "@/lib/db/queries";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId")?.trim();
  const after = searchParams.get("after");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const messages = after
    ? await listMessagesAfter({ sessionId, afterCreatedAt: after })
    : await listSessionMessages(sessionId);

  return Response.json({
    sessionId,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      agentId: m.agent_id,
      metadata: m.metadata,
      createdAt: m.created_at,
    })),
  });
}
