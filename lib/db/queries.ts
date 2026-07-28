import { getSql, dbUnavailableMessage } from "@/lib/db/client";

export type Profile = {
  id: string;
  full_name: string | null;
  headline: string | null;
  public_bio: string | null;
  structured: Record<string, unknown>;
  onboarding_state: "new" | "cv_uploaded" | "questions_asked" | "complete";
  onboarding_questions: string[];
  onboarding_answers: string[];
};

export type PendingQuestion = {
  id: string;
  source: string;
  question: string;
  context: string | null;
  status: string;
  answer: string | null;
  visitor_session_id: string | null;
  public_reply: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
};

export type DocumentKind = "cv" | "project" | "note" | "other";

export type DocumentRecord = {
  id: string;
  kind: DocumentKind;
  filename: string;
  mime_type: string | null;
  description: string | null;
  chunk_count: number;
  vector_ids: string[];
  created_at: string;
};

export type DocumentDetail = DocumentRecord & {
  content_text: string;
  metadata: Record<string, unknown>;
};

export type VisitorSession = {
  id: string;
  label: string | null;
  status: string;
  preview: string | null;
  message_count: number;
  open_pending_count: number;
  interest_flag: boolean;
  interest_score: number;
  interest_reasons: string[];
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  /** Derived: open pending OR interesting/high-signal. */
  needs_attention: boolean;
};

export type StoredMessage = {
  id: string;
  surface: string;
  agent_id: string;
  role: string;
  content: string;
  session_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

function mapVisitorSession(row: Record<string, unknown>): VisitorSession {
  const openPending = Number(row.open_pending_count ?? 0);
  const interestFlag = Boolean(row.interest_flag);
  return {
    id: String(row.id),
    label: (row.label as string) ?? null,
    status: String(row.status ?? "active"),
    preview: (row.preview as string) ?? null,
    message_count: Number(row.message_count ?? 0),
    open_pending_count: openPending,
    interest_flag: interestFlag,
    interest_score: Number(row.interest_score ?? 0),
    interest_reasons: asStringArray(row.interest_reasons),
    last_message_at: row.last_message_at ? String(row.last_message_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    needs_attention: openPending > 0 || interestFlag,
  };
}

export async function ensureProfile(): Promise<Profile | null> {
  const sql = getSql();
  if (!sql) return null;

  const rows = await sql`
    INSERT INTO profiles (id, full_name, headline, public_bio)
    VALUES (
      'peter',
      'Peter',
      'Builder & strategist',
      'Peter is a thoughtful operator who blends product sense with practical execution. Ask Peter''s Agent what you need — introductions, context, or next steps — and it will help within what Peter has made public.'
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING *
  `;

  if (rows[0]) return mapProfile(rows[0]);

  const existing = await sql`SELECT * FROM profiles WHERE id = 'peter' LIMIT 1`;
  return existing[0] ? mapProfile(existing[0]) : null;
}

function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    full_name: (row.full_name as string) ?? null,
    headline: (row.headline as string) ?? null,
    public_bio: (row.public_bio as string) ?? null,
    structured: (row.structured as Record<string, unknown>) ?? {},
    onboarding_state: row.onboarding_state as Profile["onboarding_state"],
    onboarding_questions: asStringArray(row.onboarding_questions),
    onboarding_answers: asStringArray(row.onboarding_answers),
  };
}

export async function getProfile(): Promise<Profile | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`SELECT * FROM profiles WHERE id = 'peter' LIMIT 1`;
    if (!rows[0]) return ensureProfile();
    return mapProfile(rows[0] as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function updateProfile(fields: {
  structured?: Record<string, unknown>;
  public_bio?: string;
  headline?: string;
  full_name?: string;
  onboarding_state?: Profile["onboarding_state"];
  onboarding_questions?: string[];
  onboarding_answers?: string[];
}): Promise<Profile | null> {
  const sql = getSql();
  if (!sql) return null;
  await ensureProfile();

  const rows = await sql`
    UPDATE profiles SET
      structured = COALESCE(${fields.structured ? JSON.stringify(fields.structured) : null}::jsonb, structured),
      public_bio = COALESCE(${fields.public_bio ?? null}, public_bio),
      headline = COALESCE(${fields.headline ?? null}, headline),
      full_name = COALESCE(${fields.full_name ?? null}, full_name),
      onboarding_state = COALESCE(${fields.onboarding_state ?? null}, onboarding_state),
      onboarding_questions = COALESCE(${fields.onboarding_questions ? JSON.stringify(fields.onboarding_questions) : null}::jsonb, onboarding_questions),
      onboarding_answers = COALESCE(${fields.onboarding_answers ? JSON.stringify(fields.onboarding_answers) : null}::jsonb, onboarding_answers),
      updated_at = NOW()
    WHERE id = 'peter'
    RETURNING *
  `;
  return rows[0] ? mapProfile(rows[0] as Record<string, unknown>) : null;
}

function mapDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    kind: (String(row.kind || "other") as DocumentKind) || "other",
    filename: String(row.filename),
    mime_type: (row.mime_type as string) ?? null,
    description: (row.description as string) ?? null,
    chunk_count: Number(row.chunk_count ?? 0),
    vector_ids: asStringArray(row.vector_ids),
    created_at: String(row.created_at),
  };
}

const DOCUMENT_KINDS = new Set(["cv", "project", "note", "other"]);

function normalizeKind(kind?: string): DocumentKind {
  if (kind && DOCUMENT_KINDS.has(kind)) return kind as DocumentKind;
  return "other";
}

export async function saveDocument(input: {
  id?: string;
  filename: string;
  mimeType?: string;
  contentText: string;
  chunkCount: number;
  kind?: string;
  description?: string | null;
  vectorIds?: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ id: string } | { error: string }> {
  const sql = getSql();
  if (!sql) return { error: dbUnavailableMessage() };
  await ensureProfile();
  const id = input.id ?? crypto.randomUUID();
  const kind = normalizeKind(input.kind);
  const rows = await sql`
    INSERT INTO documents (
      id, filename, mime_type, content_text, chunk_count, kind,
      description, vector_ids, metadata
    )
    VALUES (
      ${id},
      ${input.filename},
      ${input.mimeType ?? null},
      ${input.contentText},
      ${input.chunkCount},
      ${kind},
      ${input.description?.trim() || null},
      ${JSON.stringify(input.vectorIds ?? [])}::jsonb,
      ${JSON.stringify(input.metadata ?? {})}::jsonb
    )
    RETURNING id
  `;
  return { id: String(rows[0].id) };
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT id, kind, filename, mime_type, description, chunk_count,
             vector_ids, created_at
      FROM documents
      WHERE profile_id = 'peter'
      ORDER BY created_at DESC
      LIMIT 200
    `;
    return rows.map((row) => mapDocument(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function getDocument(
  id: string,
): Promise<DocumentDetail | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT * FROM documents WHERE id = ${id} LIMIT 1
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ...mapDocument(row),
      content_text: String(row.content_text ?? ""),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}

export async function deleteDocument(
  id: string,
): Promise<{ deleted: boolean; vectorIds: string[] }> {
  const sql = getSql();
  if (!sql) return { deleted: false, vectorIds: [] };
  try {
    const rows = await sql`
      DELETE FROM documents WHERE id = ${id}
      RETURNING vector_ids
    `;
    if (!rows[0]) return { deleted: false, vectorIds: [] };
    return {
      deleted: true,
      vectorIds: asStringArray(rows[0].vector_ids),
    };
  } catch {
    return { deleted: false, vectorIds: [] };
  }
}

export async function ensureVisitorSession(
  sessionId: string,
  extras?: { label?: string },
): Promise<VisitorSession | null> {
  const sql = getSql();
  if (!sql) return null;
  const id = sessionId.trim();
  if (!id) return null;
  try {
    const rows = await sql`
      INSERT INTO visitor_sessions (id, label)
      VALUES (${id}, ${extras?.label ?? null})
      ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
      RETURNING *
    `;
    return rows[0] ? mapVisitorSession(rows[0] as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function touchVisitorSession(
  sessionId: string,
  input: {
    preview?: string;
    bumpMessages?: boolean;
  },
): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  const id = sessionId.trim();
  if (!id) return;
  try {
    await ensureVisitorSession(id);
    const openRows = await sql`
      SELECT COUNT(*)::int AS c FROM pending_questions
      WHERE visitor_session_id = ${id} AND status = 'open'
    `;
    const openCount = Number(openRows[0]?.c ?? 0);
    if (input.bumpMessages) {
      await sql`
        UPDATE visitor_sessions SET
          preview = COALESCE(${input.preview ?? null}, preview),
          message_count = message_count + 1,
          open_pending_count = ${openCount},
          last_message_at = NOW(),
          updated_at = NOW()
        WHERE id = ${id}
      `;
    } else {
      await sql`
        UPDATE visitor_sessions SET
          preview = COALESCE(${input.preview ?? null}, preview),
          open_pending_count = ${openCount},
          updated_at = NOW()
        WHERE id = ${id}
      `;
    }
  } catch {
    // best-effort
  }
}

export async function listVisitorSessions(
  limit = 50,
  opts?: { attentionOnly?: boolean },
): Promise<VisitorSession[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = opts?.attentionOnly
      ? await sql`
          SELECT * FROM visitor_sessions
          WHERE open_pending_count > 0 OR interest_flag = TRUE
          ORDER BY COALESCE(last_message_at, updated_at) DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT * FROM visitor_sessions
          ORDER BY COALESCE(last_message_at, updated_at) DESC
          LIMIT ${limit}
        `;
    return rows.map((row) => mapVisitorSession(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

/** Persist interest classification; keeps the highest score / union of reasons. */
export async function flagVisitorInterest(
  sessionId: string,
  input: { score: number; reasons: string[] },
): Promise<VisitorSession | null> {
  const sql = getSql();
  if (!sql) return null;
  const id = sessionId.trim();
  if (!id || input.score <= 0 || input.reasons.length === 0) return null;
  try {
    await ensureVisitorSession(id);
    const current = await getVisitorSession(id);
    const mergedReasons = Array.from(
      new Set([...(current?.interest_reasons ?? []), ...input.reasons]),
    );
    const nextScore = Math.max(current?.interest_score ?? 0, input.score);
    const rows = await sql`
      UPDATE visitor_sessions SET
        interest_flag = TRUE,
        interest_score = ${nextScore},
        interest_reasons = ${JSON.stringify(mergedReasons)}::jsonb,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    return rows[0]
      ? mapVisitorSession(rows[0] as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function getVisitorSession(
  id: string,
): Promise<VisitorSession | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT * FROM visitor_sessions WHERE id = ${id} LIMIT 1
    `;
    return rows[0]
      ? mapVisitorSession(rows[0] as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function listSessionMessages(
  sessionId: string,
  limit = 200,
): Promise<StoredMessage[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT * FROM messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: String(row.id),
      surface: String(row.surface),
      agent_id: String(row.agent_id),
      role: String(row.role),
      content: String(row.content),
      session_id: (row.session_id as string) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      created_at: String(row.created_at),
    }));
  } catch {
    return [];
  }
}

/** If the latest CEO assistant message is an open visitor escalation, return it. */
export async function findAwaitingAdminEscalation(
  adminSessionId = "admin-ceo",
): Promise<{
  messageId: string;
  pendingId: string;
  visitorSessionId: string | null;
  question: string;
} | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT id, content, metadata, created_at
      FROM messages
      WHERE surface = 'admin'
        AND agent_id = 'ceo'
        AND session_id = ${adminSessionId}
        AND role = 'assistant'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const meta = (row.metadata as Record<string, unknown>) ?? {};
    if (meta.kind !== "visitor-escalation") return null;
    const pendingId = typeof meta.pendingId === "string" ? meta.pendingId : null;
    if (!pendingId) return null;
    const pending = await getPendingQuestion(pendingId);
    if (!pending || pending.status !== "open") return null;
    return {
      messageId: String(row.id),
      pendingId,
      visitorSessionId: pending.visitor_session_id,
      question: pending.question,
    };
  } catch {
    return null;
  }
}

export async function listMessagesAfter(input: {
  sessionId: string;
  afterCreatedAt?: string | null;
  limit?: number;
}): Promise<StoredMessage[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = input.afterCreatedAt
      ? await sql`
          SELECT * FROM messages
          WHERE session_id = ${input.sessionId}
            AND created_at > ${input.afterCreatedAt}::timestamptz
          ORDER BY created_at ASC
          LIMIT ${input.limit ?? 50}
        `
      : await sql`
          SELECT * FROM messages
          WHERE session_id = ${input.sessionId}
          ORDER BY created_at ASC
          LIMIT ${input.limit ?? 200}
        `;
    return rows.map((row) => ({
      id: String(row.id),
      surface: String(row.surface),
      agent_id: String(row.agent_id),
      role: String(row.role),
      content: String(row.content),
      session_id: (row.session_id as string) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      created_at: String(row.created_at),
    }));
  } catch {
    return [];
  }
}

export async function saveMessage(input: {
  surface: "admin" | "visitor";
  agentId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO messages (surface, agent_id, role, content, session_id, metadata)
      VALUES (
        ${input.surface},
        ${input.agentId},
        ${input.role},
        ${input.content},
        ${input.sessionId?.trim() || null},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `;
    if (input.surface === "visitor" && input.sessionId) {
      await touchVisitorSession(input.sessionId, {
        preview: input.content.slice(0, 160),
        bumpMessages: true,
      });
    }
  } catch {
    // Persistence is best-effort when schema not applied yet
  }
}

function mapPending(row: Record<string, unknown>): PendingQuestion {
  return {
    id: String(row.id),
    source: String(row.source),
    question: String(row.question),
    context: (row.context as string) ?? null,
    status: String(row.status),
    answer: (row.answer as string) ?? null,
    visitor_session_id: (row.visitor_session_id as string) ?? null,
    public_reply: (row.public_reply as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at),
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
  };
}

export async function listPendingQuestions(
  status: "open" | "answered" | "dismissed" | "all" = "open",
): Promise<PendingQuestion[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows =
      status === "all"
        ? await sql`SELECT * FROM pending_questions ORDER BY created_at DESC LIMIT 100`
        : await sql`SELECT * FROM pending_questions WHERE status = ${status} ORDER BY created_at DESC LIMIT 100`;
    return rows.map((row) => mapPending(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function getPendingQuestion(
  id: string,
): Promise<PendingQuestion | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT * FROM pending_questions WHERE id = ${id} LIMIT 1
    `;
    return rows[0] ? mapPending(rows[0] as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function listVisitorReplies(input: {
  visitorSessionId: string;
  includeDelivered?: boolean;
}): Promise<PendingQuestion[]> {
  const sql = getSql();
  if (!sql) return [];
  const sessionId = input.visitorSessionId.trim();
  if (!sessionId) return [];
  try {
    const rows = await sql`
      SELECT * FROM pending_questions
      WHERE visitor_session_id = ${sessionId}
        AND status = 'answered'
        AND public_reply IS NOT NULL
        AND TRIM(public_reply) <> ''
      ORDER BY resolved_at DESC NULLS LAST, created_at DESC
      LIMIT 50
    `;
    const mapped = rows.map((row) => mapPending(row as Record<string, unknown>));
    if (input.includeDelivered) return mapped;
    return mapped.filter((item) => !item.metadata?.delivered_to_visitor);
  } catch {
    return [];
  }
}

export async function markPendingDelivered(
  id: string,
): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  try {
    await sql`
      UPDATE pending_questions
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
        delivered_to_visitor: true,
        delivered_at: new Date().toISOString(),
      })}::jsonb
      WHERE id = ${id}
    `;
    return true;
  } catch {
    return false;
  }
}

export async function findOpenPendingDuplicate(input: {
  question: string;
  visitorSessionId?: string | null;
  withinMinutes?: number;
}): Promise<PendingQuestion | null> {
  const sql = getSql();
  if (!sql) return null;
  const minutes = input.withinMinutes ?? 120;
  const q = input.question.trim();
  if (!q) return null;
  try {
    const rows = input.visitorSessionId
      ? await sql`
          SELECT * FROM pending_questions
          WHERE status = 'open'
            AND question = ${q}
            AND visitor_session_id = ${input.visitorSessionId}
            AND created_at > NOW() - (${minutes}::text || ' minutes')::interval
          ORDER BY created_at DESC
          LIMIT 1
        `
      : await sql`
          SELECT * FROM pending_questions
          WHERE status = 'open'
            AND question = ${q}
            AND created_at > NOW() - (${minutes}::text || ' minutes')::interval
          ORDER BY created_at DESC
          LIMIT 1
        `;
    return rows[0] ? mapPending(rows[0] as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function createPendingQuestion(input: {
  source:
    | "public-face"
    | "internet-researcher"
    | "ceo"
    | "system"
    | "public-orchestrator";
  question: string;
  context?: string;
  visitorSessionId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`
      INSERT INTO pending_questions (
        source, question, context, visitor_session_id, metadata
      )
      VALUES (
        ${input.source},
        ${input.question},
        ${input.context ?? null},
        ${input.visitorSessionId?.trim() || null},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
      RETURNING id
    `;
    return { id: String(rows[0].id) };
  } catch {
    return null;
  }
}

export async function resolvePendingQuestion(
  id: string,
  status: "answered" | "dismissed",
  answer?: string,
  extras?: {
    publicReply?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  try {
    const metaPatch = extras?.metadata
      ? JSON.stringify(extras.metadata)
      : null;
    await sql`
      UPDATE pending_questions
      SET status = ${status},
          answer = COALESCE(${answer ?? null}, answer),
          public_reply = COALESCE(${extras?.publicReply ?? null}, public_reply),
          metadata = CASE
            WHEN ${metaPatch}::jsonb IS NULL THEN metadata
            ELSE COALESCE(metadata, '{}'::jsonb) || ${metaPatch}::jsonb
          END,
          resolved_at = NOW()
      WHERE id = ${id}
    `;
    return true;
  } catch {
    return false;
  }
}

export async function createAgentRun(input: {
  agentId: string;
  kind: string;
  status?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}): Promise<string | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`
      INSERT INTO agent_runs (agent_id, kind, status, input, output, error, finished_at)
      VALUES (
        ${input.agentId},
        ${input.kind},
        ${input.status ?? "queued"},
        ${JSON.stringify(input.input ?? {})}::jsonb,
        ${JSON.stringify(input.output ?? {})}::jsonb,
        ${input.error ?? null},
        ${input.status === "succeeded" || input.status === "failed" ? new Date().toISOString() : null}
      )
      RETURNING id
    `;
    return String(rows[0].id);
  } catch {
    return null;
  }
}

export async function updateAgentRun(
  id: string,
  fields: {
    status: string;
    output?: Record<string, unknown>;
    error?: string;
  },
): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  try {
    await sql`
      UPDATE agent_runs
      SET status = ${fields.status},
          output = COALESCE(${fields.output ? JSON.stringify(fields.output) : null}::jsonb, output),
          error = COALESCE(${fields.error ?? null}, error),
          finished_at = NOW()
      WHERE id = ${id}
    `;
  } catch {
    // ignore
  }
}
