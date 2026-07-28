/**
 * Daily spend ceiling + public request rate limits (env-overridable).
 *
 * Money cap is ONE shared UTC-day pool across the whole app
 * (public + admin + RAG + cron). Rate limits are abuse soft-guards only.
 */

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

/** Attribution label only — does not create separate wallets. */
export type SpendSurface = "public" | "admin" | "system";

export function budgetConfig() {
  return {
    /** Shared hard ceiling across ALL AI spend (UTC day). */
    dailyBudgetUsd: readNumber("DAILY_BUDGET_USD", 100),
    /** When true (default), refuse AI if Neon tracking is unavailable. */
    enforce: readBool("BUDGET_ENFORCE", true),
    /** Public chat: max requests per IP per sliding window (abuse soft-limit). */
    publicIpPerWindow: readNumber("PUBLIC_RATE_LIMIT_IP", 12),
    /** Public chat: max requests per visitor session per sliding window. */
    publicSessionPerWindow: readNumber("PUBLIC_RATE_LIMIT_SESSION", 20),
    /** Sliding window length in seconds for public rate limits. */
    publicWindowSeconds: readNumber("PUBLIC_RATE_LIMIT_WINDOW_SECONDS", 60),
  };
}

/** Map chat body surface → spend attribution label. */
export function spendSurfaceFromChat(
  surface: "visitor" | "admin",
): SpendSurface {
  return surface === "visitor" ? "public" : "admin";
}
