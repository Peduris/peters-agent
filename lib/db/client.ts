import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env, hasNeon } from "@/lib/env";

let sql: NeonQueryFunction<false, false> | null = null;

export function getSql() {
  if (!hasNeon()) return null;
  if (!sql) {
    sql = neon(env.databaseUrl()!);
  }
  return sql;
}

export function dbUnavailableMessage() {
  return "DATABASE_URL is not configured. Add a Neon connection string to .env.local (or connect Neon in Vercel Storage).";
}
