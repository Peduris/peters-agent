# Peter's Agent — repo notes for coding agents

## Product surfaces
- `/` — visitor chat (Public Face only), brand **Peter's Agent**; header jump **Open Admin →**
- `/admin` — owner workspace with top menu: **Chat**, **Profile / Knowledge**, **AI conversations**; header jump **← Public site**
  - Chat: multi-agent (default CEO), sidebar agents + session context, sticky composer, escalations in CEO chat
  - Profile / Knowledge: document library, CV upload, 5Q onboarding
  - AI conversations: **All Agent runs** + **Conversations requiring my attention** (open pending OR interest flag)

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
