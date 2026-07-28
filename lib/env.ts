/**
 * Env helpers — never log secret values.
 * App boots even when optional services are missing.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  if (!value || !value.trim()) return undefined;
  return value.trim();
}

export const env = {
  anthropicApiKey: () => read("ANTHROPIC_API_KEY"),
  openaiApiKey: () => read("OPENAI_API_KEY"),
  /** Neon connection string — prefer DATABASE_URL, fall back to Marketplace POSTGRES_URL. */
  databaseUrl: () => read("DATABASE_URL") || read("POSTGRES_URL"),
  upstashVectorUrl: () => read("UPSTASH_VECTOR_REST_URL"),
  upstashVectorToken: () => read("UPSTASH_VECTOR_REST_TOKEN"),
  cronSecret: () => read("CRON_SECRET"),
};

export function hasAnthropic(): boolean {
  return Boolean(env.anthropicApiKey());
}

export function hasOpenAI(): boolean {
  return Boolean(env.openaiApiKey());
}

export function hasNeon(): boolean {
  return Boolean(env.databaseUrl());
}

export function hasUpstash(): boolean {
  return Boolean(env.upstashVectorUrl() && env.upstashVectorToken());
}

export function missingServices(): string[] {
  const missing: string[] = [];
  if (!hasAnthropic()) missing.push("ANTHROPIC_API_KEY");
  if (!hasOpenAI()) missing.push("OPENAI_API_KEY");
  if (!hasNeon()) missing.push("DATABASE_URL");
  if (!hasUpstash()) missing.push("UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN");
  if (!env.cronSecret()) missing.push("CRON_SECRET");
  return missing;
}
