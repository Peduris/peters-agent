import { deleteDocument, getDocument, listDocuments } from "@/lib/db/queries";
import { deleteVectors } from "@/lib/rag/vector";
import { hasNeon, hasUpstash } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!hasNeon()) {
    return Response.json(
      { documents: [], neon: false, error: "DATABASE_URL not configured" },
      { status: 200 },
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const doc = await getDocument(id);
    if (!doc) {
      return Response.json({ error: "Document not found" }, { status: 404 });
    }
    // Never return full content_text in list views; detail omits huge body by default
    const includeText = searchParams.get("includeText") === "1";
    return Response.json({
      document: includeText
        ? doc
        : {
            id: doc.id,
            kind: doc.kind,
            filename: doc.filename,
            mime_type: doc.mime_type,
            description: doc.description,
            chunk_count: doc.chunk_count,
            vector_ids: doc.vector_ids,
            created_at: doc.created_at,
            metadata: doc.metadata,
          },
      neon: true,
    });
  }

  const documents = await listDocuments();
  return Response.json({ documents, neon: true });
}

export async function DELETE(req: Request) {
  if (!hasNeon()) {
    return Response.json(
      { error: "DATABASE_URL not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  let id = searchParams.get("id");
  if (!id) {
    try {
      const body = (await req.json()) as { id?: string };
      id = body.id ?? null;
    } catch {
      id = null;
    }
  }

  if (!id) {
    return Response.json({ error: "Missing document id" }, { status: 400 });
  }

  const existing = await getDocument(id);
  if (!existing) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  const { deleted, vectorIds } = await deleteDocument(id);
  if (!deleted) {
    return Response.json({ error: "Could not delete document" }, { status: 500 });
  }

  let vectorsDeleted = 0;
  let vectorError: string | undefined;
  const idsToDelete = vectorIds.length > 0 ? vectorIds : existing.vector_ids;

  if (idsToDelete.length > 0 && hasUpstash()) {
    const result = await deleteVectors(idsToDelete);
    vectorsDeleted = result.deleted;
    vectorError = result.error;
  }

  return Response.json({
    ok: true,
    id,
    vectorsDeleted,
    vectorError,
  });
}
