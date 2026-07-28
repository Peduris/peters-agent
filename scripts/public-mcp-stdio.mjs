#!/usr/bin/env node
/**
 * Stdio MCP entry for Claude Desktop.
 * Proxies to the remote Streamable HTTP MCP endpoint via mcp-remote.
 *
 * Env:
 *   MCP_API_KEY   (required) — Bearer token
 *   MCP_REMOTE_URL (optional) — default https://peters-agent.vercel.app/api/mcp/mcp
 *
 * Claude Desktop config: see agents/public-mcp/SKILL.md
 */
import { spawn } from "node:child_process";

const remoteUrl =
  process.env.MCP_REMOTE_URL?.trim() ||
  "https://peters-agent.vercel.app/api/mcp/mcp";
const apiKey = process.env.MCP_API_KEY?.trim();

if (!apiKey) {
  console.error(
    "[public-mcp-stdio] Set MCP_API_KEY (Bearer token for the public MCP server).",
  );
  process.exit(1);
}

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "-y",
    "mcp-remote",
    remoteUrl,
    "--header",
    `Authorization:Bearer ${apiKey}`,
  ],
  {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
