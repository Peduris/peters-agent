import {
  ensureVisitorSession,
  getVisitorSession,
  listSessionMessages,
  listVisitorReplies,
  listVisitorSessions,
  markPendingDelivered,
} from "@/lib/db/queries";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const includeMessages = searchParams.get("messages") === "1";
  const replies = searchParams.get("replies") === "1";
  const markDelivered = searchParams.get("markDelivered") === "1";

  if (id) {
    const session = await getVisitorSession(id);
    if (!session) {
      // Soft-create so visitor resume still works before first message
      const created = await ensureVisitorSession(id);
      if (!created) {
        return Response.json({ error: "Session unavailable" }, { status: 503 });
      }
    }
    const current = (await getVisitorSession(id)) ?? (await ensureVisitorSession(id));
    const messages = includeMessages ? await listSessionMessages(id) : undefined;
    let pendingReplies;
    if (replies) {
      pendingReplies = await listVisitorReplies({
        visitorSessionId: id,
        includeDelivered: false,
      });
      if (markDelivered) {
        for (const item of pendingReplies) {
          await markPendingDelivered(item.id);
        }
      }
    }
    return Response.json({
      session: current,
      messages,
      replies: pendingReplies?.map((p) => ({
        id: p.id,
        question: p.question,
        publicReply: p.public_reply,
        answeredAt: p.resolved_at,
      })),
    });
  }

  const sessions = await listVisitorSessions(60);
  return Response.json({ sessions });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id =
    typeof body.id === "string" && body.id.trim()
      ? body.id.trim()
      : crypto.randomUUID();
  const label = typeof body.label === "string" ? body.label : undefined;
  const session = await ensureVisitorSession(id, { label });
  if (!session) {
    return Response.json({ error: "Could not create session (Neon?)" }, { status: 503 });
  }
  return Response.json({ session });
}
