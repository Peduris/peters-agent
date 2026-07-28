import { runInternetResearch } from "@/lib/ai/research";
import { env } from "@/lib/env";

export const maxDuration = 60;

function authorize(req: Request): boolean {
  const secret = env.cronSecret();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const header = req.headers.get("x-cron-secret");
  return header === secret;
}

async function runResearch() {
  const result = await runInternetResearch({
    brief:
      "Daily job-market and skills scan driven by Peter's current profile and goals. Identify demand signals, skill gaps, and positioning notes.",
    kind: "daily-market-scan",
    persistRag: true,
    persistFollowUps: true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    focus: result.output.focus,
    followUps: result.output.followUps,
    findingsCount: result.output.findings.length,
    ragUpserted: result.ragUpserted,
    pendingQueued: result.pendingQueued,
  };
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runResearch();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(req: Request) {
  return GET(req);
}
