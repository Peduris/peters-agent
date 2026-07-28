import { env } from "@/lib/env";

/**
 * Accept Authorization: Bearer <MCP_API_KEY> or x-api-key: <MCP_API_KEY>.
 * Returns false when MCP_API_KEY is unset (fail closed).
 */
export function isMcpAuthorized(req: Request): boolean {
  const expected = env.mcpApiKey();
  if (!expected) return false;

  const apiKey = req.headers.get("x-api-key")?.trim();
  if (apiKey && timingSafeEqualString(apiKey, expected)) return true;

  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const token = match?.[1]?.trim();
  if (!token) return false;
  return timingSafeEqualString(token, expected);
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export function mcpUnauthorizedResponse(): Response {
  return Response.json(
    {
      error: "Unauthorized. Provide Authorization: Bearer <MCP_API_KEY> or x-api-key.",
      code: "mcp_unauthorized",
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="peters-agent-mcp"',
      },
    },
  );
}
