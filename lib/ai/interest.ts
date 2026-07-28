/**
 * Heuristic interest classifier for visitor threads.
 * Flags recruiting / interview / high-signal outreach so they appear in
 * "Conversations requiring my attention" even before an escalation.
 */

export type InterestMatch = {
  score: number;
  reasons: string[];
};

const PATTERNS: Array<{ reason: string; weight: number; re: RegExp }> = [
  { reason: "interview", weight: 0.9, re: /\b(interview|interviews|interviewing)\b/i },
  {
    reason: "job-offer",
    weight: 0.95,
    re: /\b(job\s+offer|offer\s+letter|extend(ing)?\s+an\s+offer|compensation\s+package)\b/i,
  },
  {
    reason: "hiring",
    weight: 0.85,
    re: /\b(hir(e|ing)|we'?re\s+hiring|open\s+role|open\s+position|headcount)\b/i,
  },
  {
    reason: "recruiter",
    weight: 0.9,
    re: /\b(recruiter|recruiting|talent\s+(partner|acquisition)|sourc(e|ing)\s+for)\b/i,
  },
  {
    reason: "scheduling",
    weight: 0.7,
    re: /\b(schedule\s+(a\s+)?(call|chat|meeting)|book\s+time|calendly|intro\s+call)\b/i,
  },
  {
    reason: "referral",
    weight: 0.65,
    re: /\b(referr(al|ed)|would\s+love\s+to\s+connect|opportunity\s+at)\b/i,
  },
  {
    reason: "role-fit",
    weight: 0.6,
    re: /\b(perfect\s+fit|your\s+(background|profile)\s+(looks|seems)|role\s+that\s+matches)\b/i,
  },
];

/** Minimum score to mark a session as interesting. */
export const INTEREST_FLAG_THRESHOLD = 0.6;

export function classifyVisitorInterest(text: string): InterestMatch {
  const trimmed = text.trim();
  if (!trimmed) return { score: 0, reasons: [] };

  const reasons: string[] = [];
  let score = 0;

  for (const pattern of PATTERNS) {
    if (pattern.re.test(trimmed)) {
      reasons.push(pattern.reason);
      score = Math.max(score, pattern.weight);
    }
  }

  // Stack mild boost when multiple signals fire
  if (reasons.length >= 2) {
    score = Math.min(1, score + 0.08 * (reasons.length - 1));
  }

  return { score, reasons };
}

export function shouldFlagInterest(match: InterestMatch): boolean {
  return match.score >= INTEREST_FLAG_THRESHOLD && match.reasons.length > 0;
}
