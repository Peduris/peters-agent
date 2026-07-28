-- Peter's Agent MVP schema (Neon Postgres)
-- Run this once against your DATABASE_URL.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY DEFAULT 'peter',
  full_name TEXT,
  headline TEXT,
  public_bio TEXT,
  structured JSONB NOT NULL DEFAULT '{}'::jsonb,
  onboarding_state TEXT NOT NULL DEFAULT 'new'
    CHECK (onboarding_state IN ('new', 'cv_uploaded', 'questions_asked', 'complete')),
  onboarding_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id TEXT NOT NULL DEFAULT 'peter' REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'cv'
    CHECK (kind IN ('cv', 'project', 'note', 'other')),
  filename TEXT NOT NULL,
  mime_type TEXT,
  description TEXT,
  content_text TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  vector_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe upgrades when documents already exists without newer columns
ALTER TABLE documents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS vector_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS documents_profile_created_idx
  ON documents (profile_id, created_at DESC);

-- Public visitor chat sessions (one thread per browser/visitor)
CREATE TABLE IF NOT EXISTS visitor_sessions (
  id TEXT PRIMARY KEY,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  preview TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  open_pending_count INTEGER NOT NULL DEFAULT 0,
  interest_flag BOOLEAN NOT NULL DEFAULT FALSE,
  interest_score REAL NOT NULL DEFAULT 0,
  interest_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_message_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe upgrades for attention / interest filter
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS interest_flag BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS interest_score REAL NOT NULL DEFAULT 0;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS interest_reasons JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS visitor_sessions_updated_idx
  ON visitor_sessions (updated_at DESC);

CREATE INDEX IF NOT EXISTS visitor_sessions_attention_idx
  ON visitor_sessions (updated_at DESC)
  WHERE open_pending_count > 0 OR interest_flag = TRUE;

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surface TEXT NOT NULL CHECK (surface IN ('admin', 'visitor')),
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  session_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE INDEX IF NOT EXISTS messages_surface_agent_created_idx
  ON messages (surface, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_session_created_idx
  ON messages (session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS pending_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  question TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'answered', 'dismissed')),
  answer TEXT,
  visitor_session_id TEXT,
  public_reply TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Safe upgrades for Public ↔ Admin knowledge loop
ALTER TABLE pending_questions ADD COLUMN IF NOT EXISTS visitor_session_id TEXT;
ALTER TABLE pending_questions ADD COLUMN IF NOT EXISTS public_reply TEXT;
ALTER TABLE pending_questions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Allow public-orchestrator as a source (drops legacy enum check if present)
ALTER TABLE pending_questions DROP CONSTRAINT IF EXISTS pending_questions_source_check;

CREATE INDEX IF NOT EXISTS pending_questions_status_created_idx
  ON pending_questions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS pending_questions_visitor_session_idx
  ON pending_questions (visitor_session_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT
);

INSERT INTO profiles (id, full_name, headline, public_bio, onboarding_state)
VALUES (
  'peter',
  'Peter',
  'Builder & strategist',
  'Peter is a thoughtful operator who blends product sense with practical execution. Ask Peter''s Agent what you need — introductions, context, or next steps — and it will help within what Peter has made public.',
  'new'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (id, label, enabled, description) VALUES
  ('ceo', 'CEO', TRUE, 'Orchestrates the team and talks with Peter'),
  ('data-storage', 'Data storage', TRUE, 'Profile modeling, CV + answers → Neon + RAG'),
  ('internet-researcher', 'Internet researcher', TRUE, 'Daily job-market scan from profile'),
  ('next-move-planner', 'Next move planner', TRUE, 'Personalized next steps'),
  ('public-face', 'Public Face', TRUE, 'Visitor-facing public answers'),
  ('public-orchestrator', 'Public orchestrator', TRUE, 'Routes visitor sessions ↔ CEO / Peter')
ON CONFLICT (id) DO NOTHING;

-- Estimated AI spend per UTC day + surface (public | admin | system)
CREATE TABLE IF NOT EXISTS ai_spend_daily (
  day DATE NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('public', 'admin', 'system')),
  estimated_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, surface)
);

CREATE INDEX IF NOT EXISTS ai_spend_daily_day_idx ON ai_spend_daily (day DESC);

-- Sliding-window rate limit buckets (public IP / session)
CREATE TABLE IF NOT EXISTS ai_rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
