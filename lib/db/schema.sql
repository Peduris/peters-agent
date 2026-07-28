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

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surface TEXT NOT NULL CHECK (surface IN ('admin', 'visitor')),
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_surface_agent_created_idx
  ON messages (surface, agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pending_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('public-face', 'internet-researcher', 'ceo', 'system')),
  question TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'answered', 'dismissed')),
  answer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pending_questions_status_created_idx
  ON pending_questions (status, created_at DESC);

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
  ('public-face', 'Public Face', TRUE, 'Visitor-facing public answers')
ON CONFLICT (id) DO NOTHING;
