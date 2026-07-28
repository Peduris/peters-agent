import { readFileSync } from "fs";
import { join } from "path";
import { neon } from "@neondatabase/serverless";
import { env, hasNeon } from "@/lib/env";

export const maxDuration = 60;

function authorize(req: Request): boolean {
  const secret = env.cronSecret();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.headers.get("x-cron-secret") === secret;
}

function splitSql(schemaText: string): string[] {
  const withoutLineComments = schemaText
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      if (idx === -1) return line;
      const before = line.slice(0, idx);
      if ((before.match(/'/g) || []).length % 2 === 1) return line;
      return before;
    })
    .join("\n");

  return withoutLineComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasNeon()) {
    return Response.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const schemaPath = join(process.cwd(), "lib/db/schema.sql");
  const schemaText = readFileSync(schemaPath, "utf8");
  const statements = splitSql(schemaText);
  const sql = neon(env.databaseUrl()!);

  const applied: string[] = [];
  try {
    for (const stmt of statements) {
      await sql.query(stmt);
      applied.push(stmt.replace(/\s+/g, " ").slice(0, 80));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json(
      {
        ok: false,
        error: message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]"),
        appliedCount: applied.length,
      },
      { status: 500 },
    );
  }

  const tables = await sql.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  const tableNames = (tables as { table_name: string }[]).map((r) => r.table_name);

  return Response.json({
    ok: true,
    statements: statements.length,
    tables: tableNames,
  });
}
