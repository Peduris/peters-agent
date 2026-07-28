import type { AgentId } from "@/lib/ai/agent-meta";
import { loadSkillMarkdown } from "@/lib/ai/agents";
import type { Profile } from "@/lib/db/queries";

export { visitorGreeting, DEFAULT_PUBLIC_BIO } from "@/lib/ai/copy";

export function buildSystemPrompt(input: {
  agentId: AgentId;
  surface: "admin" | "visitor";
  profile: Profile | null;
  ragContext?: string;
  extraAdminBlock?: string | false | null;
}): string {
  const skill = loadSkillMarkdown(input.agentId);
  const profileBlock = formatProfile(input.profile, input.surface);
  const ragBlock = input.ragContext?.trim()
    ? `\n\n## Retrieved context\n${input.ragContext}`
    : "\n\n## Retrieved context\n(none)";

  const surfaceRules =
    input.surface === "visitor"
      ? `
## Surface: visitor
You are speaking as Peter's Agent to an external visitor.
Never reveal private career details, contact info, or internal notes unless they appear in public retrieved context.
If you cannot answer from public context, call escalateToPeter (when available), then be politely evasive — do not invent facts.
`
      : `
## Surface: admin
You are speaking with Peter (the owner). Be direct, practical, and collaborative.
You may reference private profile data and retrieved context.
Visitor escalations arrive via the public orchestrator queue — ask Peter and use answerVisitorPending to deliver replies to the correct session.
`;

  const extra =
    typeof input.extraAdminBlock === "string" ? input.extraAdminBlock : "";

  return `${skill}

${surfaceRules}

## Current profile snapshot
${profileBlock}
${ragBlock}${extra}`;
}

function formatProfile(
  profile: Profile | null,
  surface: "admin" | "visitor",
): string {
  if (!profile) {
    return "(Profile unavailable — Neon not configured or schema not applied.)";
  }
  if (surface === "visitor") {
    return JSON.stringify(
      {
        full_name: profile.full_name,
        headline: profile.headline,
        public_bio: profile.public_bio,
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      full_name: profile.full_name,
      headline: profile.headline,
      public_bio: profile.public_bio,
      onboarding_state: profile.onboarding_state,
      structured: profile.structured,
      onboarding_questions: profile.onboarding_questions,
      onboarding_answers: profile.onboarding_answers,
    },
    null,
    2,
  );
}
