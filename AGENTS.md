# Peter's Agent — repo notes for coding agents

## Product surfaces
- `/` — visitor chat (Public Face only), brand **Peter's Agent**
- `/admin` — owner multi-agent chat (default CEO), CV upload, 5Q onboarding, pending inbox

## Agent skills
Behavior contracts live in `agents/<name>/SKILL.md` and are loaded server-side into system prompts.

## Data
- Neon schema: `lib/db/schema.sql`
- RAG: `lib/rag/*` (Upstash + OpenAI embeddings)
- Secrets: `.env.local` only — never commit or print values

## Local
```bash
npm install && npm run dev
```
