type Assertion = { beat: string; id: string; status: string };
type Summary = {
  firstFailure: string | null;
  notRun: string[];
  turns: Array<{ beat: string }>;
  assertions: Assertion[];
};
type Judgment = { status: 'pass' | 'fail'; evidence: string };
type Review = {
  reviewer: string;
  runtimeAgentIdentityVerified?: boolean;
  judgments: Record<string, Judgment>;
};

/** Mechanical receipts and independent semantic judgments must both close. */
export function evaluateGraduationReview(summary: Summary, review: Review) {
  const remaining: string[] = [];
  if (summary.firstFailure) remaining.push(`first-failure:${summary.firstFailure}`);
  if (summary.notRun.length) remaining.push(`not-run:${summary.notRun.join(',')}`);
  const expected = Array.from({ length: 13 }, (_, index) => `G${index + 1}`);
  const actual = summary.turns.map((turn) => turn.beat);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    remaining.push('incomplete-or-out-of-order-turns');
  if (!review.reviewer.trim()) remaining.push('missing-independent-reviewer');
  if (review.runtimeAgentIdentityVerified !== true)
    remaining.push('runtime-agent-identity-unverified');
  const occurrences = new Map<string, number>();
  for (const item of summary.assertions) {
    const base = `${item.beat}:${item.id}`;
    const count = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, count);
    const key = count === 1 ? base : `${base}#${count}`;
    if (item.status !== 'pass' && item.status !== 'unknown') {
      remaining.push(key);
      continue;
    }
    if (item.status !== 'unknown') continue;
    const judgment = review.judgments[key];
    if (!judgment || judgment.status !== 'pass' || judgment.evidence.trim().length < 20)
      remaining.push(key);
  }
  return { accepted: remaining.length === 0, remaining };
}
