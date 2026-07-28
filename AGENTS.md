# Peter's Agent — repo notes for coding agents

## Product surfaces
- `/` — visitor chat (Public Face only), brand **Peter's Agent**
- `/admin` — owner multi-agent chat (default CEO), **Profile / Knowledge** library, CV upload, 5Q onboarding, pending inbox

## Agent skills
Behavior contracts live in `agents/<name>/SKILL.md` and are loaded server-side into system prompts.

## Data
- Neon schema: `lib/db/schema.sql` (includes `documents.description`, `vector_ids`)
- RAG: `lib/rag/*` (Upstash + OpenAI embeddings); document vectors use ids `doc-{uuid}-*`
- Admin knowledge APIs: `GET/DELETE /api/documents`, `POST /api/ingest` (file + kind + description)
- Secrets: `.env.local` only — never commit or print values

## Local
```bash
npm install && npm run dev
```
