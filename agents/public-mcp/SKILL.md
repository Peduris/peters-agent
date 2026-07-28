---
name: public-mcp
description: Public MCP surface for Peter's Agent (Claude Desktop / remote clients).
---

# Public MCP

Exposes **Peter's Agent** (Public Face + public RAG) as an MCP server so clients like Claude Desktop can call it.

## Tools

| Tool | Args | Behavior |
|------|------|----------|
| `ask_peters_agent` | `question` (string), optional `session_id` (UUID) | Same path as visitor chat: public bio + public RAG, Public Face skill, escalate-to-Peter when confidence is low. Returns `{ answer, session_id, escalated }`. |
| `get_public_profile` | _(none)_ | Returns public `full_name`, `headline`, `public_bio` only. |

## Auth

Required on every MCP HTTP request:

- `Authorization: Bearer <MCP_API_KEY>`, or
- `x-api-key: <MCP_API_KEY>`

Set `MCP_API_KEY` in `.env.local` and Vercel Production/Preview env. Never commit the value.

When the key is missing on the server, all MCP calls fail closed (401).

## Endpoints (remote / Vercel)

| Transport | URL |
|-----------|-----|
| Streamable HTTP (preferred) | `https://peters-agent.vercel.app/api/mcp/mcp` |
| Legacy SSE | `https://peters-agent.vercel.app/api/mcp/sse` |

Local: `http://localhost:3000/api/mcp/mcp`

## Cost & rate limits

MCP asks use the same **shared daily spend pool** and public rate-limit layer as visitor chat (`lib/budget`):

- Shared UTC-day USD ceiling (`DAILY_BUDGET_USD`)
- Per-IP / per-session sliding windows on public asks
- Chat reserve + settle on token usage

## Claude Desktop — remote via `mcp-remote` (recommended)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "peters-agent": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://peters-agent.vercel.app/api/mcp/mcp",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

Restart Claude Desktop. You should see tools `ask_peters_agent` and `get_public_profile`.

## Claude Desktop — local stdio (repo checkout)

Requires Node 18+, repo deps installed, and the same env vars as the app (including `MCP_API_KEY` only if you also hit remote; for in-process stdio you need Anthropic/Neon/etc.):

```json
{
  "mcpServers": {
    "peters-agent-local": {
      "command": "npm",
      "args": ["run", "mcp:stdio"],
      "cwd": "/ABSOLUTE/PATH/TO/peters-agent",
      "env": {
        "ANTHROPIC_API_KEY": "…",
        "OPENAI_API_KEY": "…",
        "DATABASE_URL": "…",
        "UPSTASH_VECTOR_REST_URL": "…",
        "UPSTASH_VECTOR_REST_TOKEN": "…"
      }
    }
  }
}
```

Prefer the remote `mcp-remote` config unless you are developing the MCP server locally.

## Cursor / HTTP clients

```json
{
  "mcpServers": {
    "peters-agent": {
      "url": "https://peters-agent.vercel.app/api/mcp/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

## Implementation map

- Route: `app/api/mcp/[transport]/route.ts`
- Ask logic: `lib/ai/public-ask.ts`
- Auth helper: `lib/mcp/auth.ts`
- Stdio entry: `scripts/public-mcp-stdio.mjs` (`npm run mcp:stdio`)
