import { AsyncLocalStorage } from "async_hooks";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { askPetersAgent, getPublicProfile } from "@/lib/ai/public-ask";
import { clientIpFromRequest } from "@/lib/budget";
import { env } from "@/lib/env";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const requestContext = new AsyncLocalStorage<{ clientIp: string }>();

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "ask_peters_agent",
      {
        title: "Ask Peter's Agent",
        description:
          "Ask Peter's public agent a question. Uses the Public Face persona with public bio + RAG. Optional session_id keeps conversation continuity and escalations.",
        inputSchema: {
          question: z
            .string()
            .min(1)
            .describe("The question or message for Peter's Agent"),
          session_id: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Optional visitor session UUID to continue a thread. Omit to start a new session; the response includes the new session_id.",
            ),
        },
      },
      async ({ question, session_id }) => {
        const clientIp = requestContext.getStore()?.clientIp ?? "mcp";
        const result = await askPetersAgent({
          question,
          sessionId: session_id,
          clientIp,
        });

        if (!result.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    ok: false,
                    error: result.error,
                    code: result.code,
                    retryAfterSeconds: result.retryAfterSeconds,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: true,
                  answer: result.answer,
                  session_id: result.sessionId,
                  escalated: Boolean(result.escalated),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "get_public_profile",
      {
        title: "Get public profile",
        description:
          "Return Peter's public name, headline, and public bio (no private profile fields).",
        inputSchema: {},
      },
      async () => {
        const profile = await getPublicProfile();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: true,
                  full_name: profile.fullName,
                  headline: profile.headline,
                  public_bio: profile.publicBio,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );
  },
  {
    serverInfo: {
      name: "peters-agent-public",
      version: "1.0.0",
    },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 120,
    verboseLogs: process.env.NODE_ENV !== "production",
  },
);

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  const expected = env.mcpApiKey();
  if (!expected || !bearerToken) return undefined;
  if (bearerToken.length !== expected.length) return undefined;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= bearerToken.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) return undefined;
  return {
    token: bearerToken,
    scopes: ["peters-agent:public"],
    clientId: "mcp-client",
  };
}

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  requiredScopes: ["peters-agent:public"],
});

/** Prefer Authorization Bearer; fall back to x-api-key. */
async function normalizeApiKeyAuth(req: Request): Promise<Request> {
  if (req.headers.get("authorization")) return req;
  const key = req.headers.get("x-api-key")?.trim();
  if (!key) return req;
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${key}`);
  return new Request(req.url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // duplex required when forwarding a ReadableStream body
    duplex: "half",
  } as RequestInit);
}

async function handle(
  req: Request,
  _ctx: { params: Promise<{ transport: string }> },
) {
  const normalized = await normalizeApiKeyAuth(req);
  const clientIp = clientIpFromRequest(normalized);
  return requestContext.run({ clientIp }, () => authHandler(normalized));
}

export { handle as GET, handle as POST, handle as DELETE };
