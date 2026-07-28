export const AGENT_IDS = [
  "ceo",
  "data-storage",
  "internet-researcher",
  "next-move-planner",
  "public-face",
  "public-orchestrator",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export type AgentMeta = {
  id: AgentId;
  label: string;
  description: string;
  adminVisible: boolean;
};

export const AGENTS: AgentMeta[] = [
  {
    id: "ceo",
    label: "CEO",
    description: "Orchestrates the team and talks with Peter",
    adminVisible: true,
  },
  {
    id: "data-storage",
    label: "Data storage",
    description: "Profile modeling · CV & answers → Neon + RAG",
    adminVisible: true,
  },
  {
    id: "internet-researcher",
    label: "Internet researcher",
    description: "Job-market scan from profile",
    adminVisible: true,
  },
  {
    id: "next-move-planner",
    label: "Next move planner",
    description: "Personalized next steps",
    adminVisible: true,
  },
  {
    id: "public-face",
    label: "Public Face",
    description: "Visitor-facing (not for admin chat)",
    adminVisible: false,
  },
  {
    id: "public-orchestrator",
    label: "Public orchestrator",
    description: "Routes visitor sessions ↔ CEO (switchboard)",
    adminVisible: false,
  },
];

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}
