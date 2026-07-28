import { askPetersAgent, getPublicProfile } from "@/lib/ai/public-ask";
import { isMcpAuthorized, mcpUnauthorizedResponse } from "@/lib/mcp/auth";
import { clientIpFromRequest } from "@/lib/budget";

export const maxDuration = 120;

/**
 * JSON shim for curl / stdio helpers.
 * Auth: same MCP_API_KEY as the MCP route (Bearer or x-api-key).
 */
export async function POST(req: Request) {
  if (!isMcpAuthorized(req)) {
    return mcpUnauthorizedResponse();
  }

  let body: { question?: unknown; session_id?: unknown; profile_only?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.profile_only === true) {
    const profile = await getPublicProfile();
    return Response.json({
      ok: true,
      full_name: profile.fullName,
      headline: profile.headline,
      public_bio: profile.publicBio,
    });
  }

  const question =
    typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return Response.json(
      { ok: false, error: "question is required" },
      { status: 400 },
    );
  }

  const sessionId =
    typeof body.session_id === "string" ? body.session_id.trim() : null;

  const result = await askPetersAgent({
    question,
    sessionId,
    clientIp: clientIpFromRequest(req),
  });

  if (!result.ok) {
    const status =
      result.code === "rate_limited" || result.code === "budget_exceeded"
        ? 429
        : result.code === "missing_anthropic"
          ? 503
          : 500;
    return Response.json(
      {
        ok: false,
        error: result.error,
        code: result.code,
        retryAfterSeconds: result.retryAfterSeconds,
      },
      {
        status,
        headers: result.retryAfterSeconds
          ? { "Retry-After": String(result.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  return Response.json({
    ok: true,
    answer: result.answer,
    session_id: result.sessionId,
    escalated: Boolean(result.escalated),
  });
}

export async function GET(req: Request) {
  if (!isMcpAuthorized(req)) {
    return mcpUnauthorizedResponse();
  }
  const profile = await getPublicProfile();
  return Response.json({
    ok: true,
    full_name: profile.fullName,
    headline: profile.headline,
    public_bio: profile.publicBio,
  });
}
