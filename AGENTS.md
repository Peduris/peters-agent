# Peter's Agent — repo notes for coding agents

## Product surfaces
- `/` — visitor chat (Public Face only), brand **Peter's Agent**; header jump **Open Admin →**
- `/admin` — owner workspace with top menu: **Chat**, **Profile / Knowledge**, **AI conversations**; header jump **← Public site**
  - Chat: multi-agent (default CEO), sidebar agents + session context, sticky composer, escalations in CEO chat
  - Profile / Knowledge: document library, CV upload, 5Q onboarding
  - AI conversations: **All Agent runs** + **Conversations requiring my attention** (open pending OR interest flag)

## Agent skills
Behavior contracts live in `agents/<name>/SKILL.md` and are loaded server-side into system prompts.

## Public MCP
- Docs: `agents/public-mcp/SKILL.md`
- Remote Streamable HTTP: `https://peters-agent.vercel.app/api/mcp/mcp`
- Auth: `Authorization: Bearer <MCP_API_KEY>` or `x-api-key` (env `MCP_API_KEY`)
- Tools: `ask_peters_agent`, `get_public_profile`
- Stdio: `npm run mcp:stdio` (proxies via `mcp-remote`)
- JSON shim: `POST /api/public-ask` (same auth)

## Data
- Neon schema: `lib/db/schema.sql` (includes `documents.description`, `vector_ids`, `ai_spend_daily`, `ai_rate_limit_buckets`)
- RAG: `lib/rag/*` (Upstash + OpenAI embeddings); document vectors use ids `doc-{uuid}-*`
- Admin knowledge APIs: `GET/DELETE /api/documents`, `POST /api/ingest` (file + kind + description)
- **Spend ceiling:** shared UTC-day pool (`DAILY_BUDGET_USD`, default 100) across all AI calls — see `lib/budget/*` (visitor chat + public MCP share this)
- Secrets: `.env.local` only — never commit or print values

## Local
```bash
npm install && npm run dev
```
