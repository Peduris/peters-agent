import { readFileSync } from "fs";
import path from "path";
import type { AgentId } from "@/lib/ai/agent-meta";

export type { AgentId } from "@/lib/ai/agent-meta";
export { AGENT_IDS, AGENTS, isAgentId } from "@/lib/ai/agent-meta";

export function loadSkillMarkdown(agentId: AgentId): string {
  const skillPath = path.join(process.cwd(), "agents", agentId, "SKILL.md");
  try {
    return readFileSync(skillPath, "utf8");
  } catch {
    return `You are the ${agentId} agent for Peter's Agent.`;
  }
}
