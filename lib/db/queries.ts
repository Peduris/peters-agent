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
  created_at: string;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
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

export async function saveDocument(input: {
  filename: string;
  mimeType?: string;
  contentText: string;
  chunkCount: number;
  kind?: string;
}): Promise<{ id: string } | { error: string }> {
  const sql = getSql();
  if (!sql) return { error: dbUnavailableMessage() };
  await ensureProfile();
  const rows = await sql`
    INSERT INTO documents (filename, mime_type, content_text, chunk_count, kind)
    VALUES (
      ${input.filename},
      ${input.mimeType ?? null},
      ${input.contentText},
      ${input.chunkCount},
      ${input.kind ?? "cv"}
    )
    RETURNING id
  `;
  return { id: String(rows[0].id) };
}

export async function saveMessage(input: {
  surface: "admin" | "visitor";
  agentId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO messages (surface, agent_id, role, content, metadata)
      VALUES (
        ${input.surface},
        ${input.agentId},
        ${input.role},
        ${input.content},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `;
  } catch {
    // Persistence is best-effort when schema not applied yet
  }
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
    return rows.map((row) => ({
      id: String(row.id),
      source: String(row.source),
      question: String(row.question),
      context: (row.context as string) ?? null,
      status: String(row.status),
      answer: (row.answer as string) ?? null,
      created_at: String(row.created_at),
    }));
  } catch {
    return [];
  }
}

export async function createPendingQuestion(input: {
  source: "public-face" | "internet-researcher" | "ceo" | "system";
  question: string;
  context?: string;
}): Promise<{ id: string } | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`
      INSERT INTO pending_questions (source, question, context)
      VALUES (${input.source}, ${input.question}, ${input.context ?? null})
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
): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  try {
    await sql`
      UPDATE pending_questions
      SET status = ${status},
          answer = COALESCE(${answer ?? null}, answer),
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
