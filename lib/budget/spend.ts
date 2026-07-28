import { getSql } from "@/lib/db/client";
import { hasNeon } from "@/lib/env";
import { budgetConfig, type SpendSurface } from "@/lib/budget/config";

export type SpendSnapshot = {
  day: string;
  bySurface: Record<SpendSurface, number>;
  total: number;
  dailyBudgetUsd: number;
  remainingUsd: number;
};

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function emptySnapshot(dailyBudgetUsd: number): SpendSnapshot {
  return {
    day: utcDay(),
    bySurface: { public: 0, admin: 0, system: 0 },
    total: 0,
    dailyBudgetUsd,
    remainingUsd: dailyBudgetUsd,
  };
}

export async function getSpendSnapshot(): Promise<SpendSnapshot | null> {
  const sql = getSql();
  if (!sql) return null;
  const day = utcDay();
  const rows = (await sql`
    SELECT surface, estimated_usd::float8 AS estimated_usd
    FROM ai_spend_daily
    WHERE day = ${day}::date
  `) as Array<{ surface: string; estimated_usd: number }>;

  const bySurface: Record<SpendSurface, number> = {
    public: 0,
    admin: 0,
    system: 0,
  };
  for (const row of rows) {
    if (row.surface === "public" || row.surface === "admin" || row.surface === "system") {
      bySurface[row.surface] = Number(row.estimated_usd) || 0;
    }
  }
  const cfg = budgetConfig();
  const total = bySurface.public + bySurface.admin + bySurface.system;
  return {
    day,
    bySurface,
    total,
    dailyBudgetUsd: cfg.dailyBudgetUsd,
    remainingUsd: Math.max(0, cfg.dailyBudgetUsd - total),
  };
}

export type ReserveResult =
  | { ok: true; reserved: number; snapshot: SpendSnapshot }
  | {
      ok: false;
      reason: "budget_exceeded" | "tracking_unavailable" | "invalid_amount";
      message: string;
      snapshot: SpendSnapshot | null;
    };

/**
 * Atomically reserve estimated USD against the single shared daily ceiling.
 * Surface is attribution-only (observability); all surfaces share one pool.
 */
export async function tryReserveSpend(
  surface: SpendSurface,
  amountUsd: number,
): Promise<ReserveResult> {
  const amount = roundUsd(amountUsd);
  if (!(amount > 0)) {
    return {
      ok: false,
      reason: "invalid_amount",
      message: "Invalid spend reservation.",
      snapshot: await getSpendSnapshot(),
    };
  }

  const cfg = budgetConfig();
  if (!hasNeon() || !getSql()) {
    if (cfg.enforce) {
      return {
        ok: false,
        reason: "tracking_unavailable",
        message:
          "Spend tracking is unavailable, so AI features are paused. Please try again later.",
        snapshot: null,
      };
    }
    return {
      ok: true,
      reserved: amount,
      snapshot: emptySnapshot(cfg.dailyBudgetUsd),
    };
  }

  const sql = getSql()!;
  const day = utcDay();
  const overallCap = cfg.dailyBudgetUsd;

  try {
    const rows = (await sql`
      WITH caps AS (
        SELECT
          ${overallCap}::float8 AS overall_cap,
          ${amount}::float8 AS amount,
          ${surface}::text AS surface,
          ${day}::date AS day
      ),
      current AS (
        SELECT COALESCE(SUM(estimated_usd), 0)::float8 AS total
        FROM ai_spend_daily
        WHERE day = (SELECT day FROM caps)
      ),
      allowed AS (
        SELECT
          CASE
            WHEN (SELECT total FROM current) + (SELECT amount FROM caps)
              > (SELECT overall_cap FROM caps)
              THEN FALSE
            ELSE TRUE
          END AS ok,
          (SELECT total FROM current) AS total_before
      ),
      upsert AS (
        INSERT INTO ai_spend_daily (day, surface, estimated_usd, request_count, updated_at)
        SELECT day, surface, amount, 1, NOW()
        FROM caps
        WHERE (SELECT ok FROM allowed)
        ON CONFLICT (day, surface) DO UPDATE SET
          estimated_usd = ai_spend_daily.estimated_usd + EXCLUDED.estimated_usd,
          request_count = ai_spend_daily.request_count + 1,
          updated_at = NOW()
        WHERE (SELECT ok FROM allowed)
        RETURNING surface, estimated_usd
      )
      SELECT
        (SELECT ok FROM allowed) AS ok,
        (SELECT total_before FROM allowed) AS total_before,
        (SELECT estimated_usd::float8 FROM upsert LIMIT 1) AS surface_after
    `) as Array<{
      ok: boolean;
      total_before: number;
      surface_after: number | null;
    }>;

    const row = rows[0];
    const snapshot = (await getSpendSnapshot()) ?? emptySnapshot(overallCap);

    if (!row?.ok) {
      return {
        ok: false,
        reason: "budget_exceeded",
        message: `Daily AI budget ($${overallCap.toFixed(0)} UTC) is exhausted across all chats. Try again tomorrow.`,
        snapshot,
      };
    }

    return { ok: true, reserved: amount, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : "spend tracking failed";
    if (cfg.enforce) {
      return {
        ok: false,
        reason: "tracking_unavailable",
        message:
          "Spend tracking is unavailable, so AI features are paused. Please try again later.",
        snapshot: null,
      };
    }
    console.error(
      "[budget] tryReserveSpend failed:",
      message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]"),
    );
    return {
      ok: true,
      reserved: amount,
      snapshot: emptySnapshot(overallCap),
    };
  }
}

/** Adjust previously reserved spend toward actual usage (may be negative). */
export async function adjustSpend(
  surface: SpendSurface,
  deltaUsd: number,
): Promise<void> {
  const delta = roundUsd(deltaUsd);
  if (delta === 0 || !hasNeon()) return;
  const sql = getSql();
  if (!sql) return;
  const day = utcDay();
  try {
    await sql`
      INSERT INTO ai_spend_daily (day, surface, estimated_usd, request_count, updated_at)
      VALUES (${day}::date, ${surface}, ${delta}, 0, NOW())
      ON CONFLICT (day, surface) DO UPDATE SET
        estimated_usd = GREATEST(0, ai_spend_daily.estimated_usd + EXCLUDED.estimated_usd),
        updated_at = NOW()
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "adjust failed";
    console.error(
      "[budget] adjustSpend failed:",
      message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]"),
    );
  }
}

/** Record actual spend with no prior reserve. */
export async function recordSpend(
  surface: SpendSurface,
  amountUsd: number,
): Promise<ReserveResult> {
  return tryReserveSpend(surface, amountUsd);
}
