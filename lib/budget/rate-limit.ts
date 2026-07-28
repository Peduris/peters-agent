import { getSql } from "@/lib/db/client";
import { hasNeon } from "@/lib/env";
import { budgetConfig } from "@/lib/budget/config";

export type RateLimitResult =
  | { ok: true }
  | { ok: false; message: string; retryAfterSeconds: number };

/**
 * Sliding fixed-window counter in Neon.
 * Returns ok:false when the bucket has exceeded `limit` hits in the window.
 */
async function hitBucket(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!(limit > 0) || !(windowSeconds > 0)) return { ok: true };

  if (!hasNeon() || !getSql()) {
    // Without Neon we cannot rate-limit; public chat path already fails closed on spend.
    return { ok: true };
  }

  const sql = getSql()!;
  try {
    const rows = (await sql`
      WITH caps AS (
        SELECT
          ${bucketKey}::text AS bucket_key,
          ${limit}::int AS hit_limit,
          ${windowSeconds}::int AS window_seconds
      ),
      upsert AS (
        INSERT INTO ai_rate_limit_buckets (bucket_key, window_started_at, hit_count, updated_at)
        VALUES ((SELECT bucket_key FROM caps), NOW(), 1, NOW())
        ON CONFLICT (bucket_key) DO UPDATE SET
          hit_count = CASE
            WHEN ai_rate_limit_buckets.window_started_at
              < NOW() - ((SELECT window_seconds FROM caps) || ' seconds')::interval
              THEN 1
            ELSE ai_rate_limit_buckets.hit_count + 1
          END,
          window_started_at = CASE
            WHEN ai_rate_limit_buckets.window_started_at
              < NOW() - ((SELECT window_seconds FROM caps) || ' seconds')::interval
              THEN NOW()
            ELSE ai_rate_limit_buckets.window_started_at
          END,
          updated_at = NOW()
        RETURNING hit_count, window_started_at
      )
      SELECT
        hit_count,
        window_started_at,
        (hit_count <= (SELECT hit_limit FROM caps)) AS allowed,
        GREATEST(
          0,
          (SELECT window_seconds FROM caps)
            - EXTRACT(EPOCH FROM (NOW() - window_started_at))::int
        ) AS retry_after
      FROM upsert
    `) as Array<{
      hit_count: number;
      allowed: boolean;
      retry_after: number;
    }>;

    const row = rows[0];
    if (row && !row.allowed) {
      return {
        ok: false,
        message:
          "Too many requests. Please slow down and try again in a moment.",
        retryAfterSeconds: Math.max(1, Number(row.retry_after) || windowSeconds),
      };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "rate limit failed";
    console.error("[budget] hitBucket failed:", message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]"));
    // Fail open on infra errors for admin ergonomics; public also has spend ceiling.
    return { ok: true };
  }
}

export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 128);
  return "unknown";
}

/** Public-only IP + session sliding-window limits. */
export async function assertPublicRateLimits(input: {
  ip: string;
  sessionId?: string | null;
}): Promise<RateLimitResult> {
  const cfg = budgetConfig();
  const ipResult = await hitBucket(
    `ip:${input.ip || "unknown"}`,
    cfg.publicIpPerWindow,
    cfg.publicWindowSeconds,
  );
  if (!ipResult.ok) return ipResult;

  if (input.sessionId?.trim()) {
    const sessionResult = await hitBucket(
      `session:${input.sessionId.trim()}`,
      cfg.publicSessionPerWindow,
      cfg.publicWindowSeconds,
    );
    if (!sessionResult.ok) return sessionResult;
  }

  return { ok: true };
}
