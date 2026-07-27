import {
  listPendingQuestions,
  resolvePendingQuestion,
} from "@/lib/db/queries";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status") ?? "open";
  const status =
    statusParam === "all" ||
    statusParam === "answered" ||
    statusParam === "dismissed"
      ? statusParam
      : "open";

  const items = await listPendingQuestions(status);
  return Response.json({ items });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const id = String(body.id ?? "");
  const status = body.status === "answered" ? "answered" : "dismissed";
  const answer = typeof body.answer === "string" ? body.answer : undefined;

  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const ok = await resolvePendingQuestion(id, status, answer);
  return Response.json({ ok });
}
