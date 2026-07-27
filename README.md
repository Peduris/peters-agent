# Peter's Agent

Personal multi-agent MVP for Peter: admin orchestration chat + public **Peter's Agent** visitor chat.

## Stack

- Next.js (App Router) on Vercel
- Anthropic Claude via Vercel AI SDK
- Neon Postgres (state)
- Upstash Vector (RAG) + OpenAI `text-embedding-3-small`

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (visitor) and [http://localhost:3000/admin](http://localhost:3000/admin) (owner).

## Environment

Copy `.env.example` → `.env.local` (or keep your existing `.env.local`). Never commit secrets — `.gitignore` ignores `.env*`.

| Variable | Required for | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Chat | Claude via Vercel AI SDK |
| `UPSTASH_VECTOR_REST_URL` | RAG | Upstash Vector endpoint |
| `UPSTASH_VECTOR_REST_TOKEN` | RAG | Upstash Vector auth |
| `OPENAI_API_KEY` | RAG ingest/query | Embeddings (`text-embedding-3-small`) for Upstash — add later if missing |
| `DATABASE_URL` | Persistence | Neon Postgres — optional for first chat deploy |
| `CRON_SECRET` | Cron | Protects `/api/cron/research` |

Apply schema once (when Neon is connected):

```bash
# Using any Postgres client against Neon:
psql "$DATABASE_URL" -f lib/db/schema.sql
```

**Minimum for chat:** `ANTHROPIC_API_KEY`. The app boots without Neon/OpenAI/Upstash; messages still stream. RAG retrieval and CV ingest need **both** Upstash Vector **and** `OPENAI_API_KEY` (embeddings). Persistence (profile, inbox) needs Neon.

## Agents

Skill contracts live in `agents/<name>/SKILL.md`:

1. `ceo` — default admin agent
2. `data-storage` — profile modeling
3. `internet-researcher` — daily market scan
4. `next-move-planner` — next steps
5. `public-face` — visitor only

## Cron

`vercel.json` schedules `GET /api/cron/research` daily at 07:00 UTC. Vercel sends `Authorization: Bearer $CRON_SECRET`.

Manual test:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/research
```

## Deploy (GitHub + Vercel)

1. Push this project to GitHub (do **not** commit `.env.local` or any secrets).
2. In Vercel: **Add New Project** → import the GitHub repo.
3. Connect **Upstash** from Vercel **Storage** (or set `UPSTASH_VECTOR_REST_URL` / `UPSTASH_VECTOR_REST_TOKEN` manually).
4. Add `ANTHROPIC_API_KEY` under Environment Variables (required for chat).
5. Later: add `OPENAI_API_KEY` for RAG embeddings, connect Neon (`DATABASE_URL`), set `CRON_SECRET`, run `lib/db/schema.sql`, redeploy.

## Key paths

- `app/admin` — owner UI
- `app/page.tsx` — visitor UI
- `app/api/chat` — streaming chat
- `app/api/ingest` — CV upload
- `app/api/onboarding` — 5-question answers
- `app/api/pending` — inbox
- `app/api/cron/research` — daily researcher
- `lib/db/schema.sql` — Neon schema
- `lib/rag` — embeddings + Upstash
