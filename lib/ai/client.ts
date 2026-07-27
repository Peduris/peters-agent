import { createAnthropic } from "@ai-sdk/anthropic";
import { env, hasAnthropic } from "@/lib/env";

export function getLanguageModel() {
  if (!hasAnthropic()) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it to .env.local or Vercel environment variables.",
    );
  }
  const anthropic = createAnthropic({ apiKey: env.anthropicApiKey() });
  return anthropic("claude-sonnet-4-5");
}
