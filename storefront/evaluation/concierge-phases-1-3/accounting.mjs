const REQUEST_KINDS = new Set(['completion', 'continuation', 'retry', 'failure']);
const ASSERTION_STATUSES = new Set(['pass', 'fail', 'unknown', 'blocked', 'not-run']);

/** Campaign-level accounting. The request budget is never inferred from turn count. */
export class CampaignLedger {
  constructor({ maximumCompletionRequests }) {
    if (!Number.isSafeInteger(maximumCompletionRequests) || maximumCompletionRequests < 1) {
      throw new Error('An explicit positive completion-request budget is required.');
    }
    this.maximumCompletionRequests = maximumCompletionRequests;
    this.turnKeys = new Set();
    this.requestIds = new Set();
    this.eventCounts = { completion: 0, continuation: 0, retry: 0, failure: 0 };
    this.results = new Map();
    this.firstFailures = new Map();
    this.stopped = false;
    this.stopReason = null;
    this.defect = false;
    this.retriedTurns = new Set();
  }

  assertRunning() {
    if (this.stopped) throw new Error(`campaign stopped: ${this.stopReason}`);
  }

  startTurn(journeyId, turnId) {
    this.assertRunning();
    const key = `${journeyId}:${turnId}`;
    if (this.turnKeys.has(key)) throw new Error(`duplicate shopper turn: ${key}`);
    this.turnKeys.add(key);
  }

  /** A transport retry re-issues an existing shopper turn; it never creates a new one. */
  startRetry(journeyId, turnId) {
    this.assertRunning();
    const key = `${journeyId}:${turnId}`;
    if (!this.turnKeys.has(key)) throw new Error(`Retry has no shopper turn: ${key}`);
    if (this.retriedTurns.has(key)) throw new Error(`Only one transport retry per turn: ${key}`);
    this.retriedTurns.add(key);
  }

  recordRequest(journeyId, turnId, kind, requestId) {
    this.assertRunning();
    if (!REQUEST_KINDS.has(kind) || !requestId)
      throw new Error('Invalid completion request event.');
    if (!this.turnKeys.has(`${journeyId}:${turnId}`))
      throw new Error('Request has no shopper turn.');
    if (this.requestIds.has(requestId)) return;
    this.requestIds.add(requestId);
    this.eventCounts[kind] += 1;
    if (this.requestIds.size > this.maximumCompletionRequests) {
      // A spent budget is a controlled campaign stop, not a harness defect. The
      // remaining journeys stay unexecuted rather than misleadingly run.
      this.stopped = true;
      this.stopReason = 'completion request budget exceeded (remaining cases unexecuted)';
      throw new Error('Completion request budget exceeded (remaining cases unexecuted).');
    }
  }

  recordAssertion(journeyId, assertionId, status, detail) {
    this.assertRunning();
    if (!ASSERTION_STATUSES.has(status)) throw new Error(`Unknown assertion status: ${status}`);
    const result = this.results.get(journeyId) ?? new Map();
    const prior = result.get(assertionId);
    if (prior?.status === 'fail') return;
    result.set(assertionId, { status, detail });
    this.results.set(journeyId, result);
    if (status === 'fail' && !this.firstFailures.has(journeyId)) {
      this.firstFailures.set(journeyId, { assertionId, detail });
    }
  }

  assertions(journeyId) {
    return Object.fromEntries(this.results.get(journeyId) ?? []);
  }

  firstFailure(journeyId) {
    return this.firstFailures.get(journeyId) ?? null;
  }

  verdict(journeyId) {
    const values = [...(this.results.get(journeyId)?.values() ?? [])];
    if (!values.length) return 'not-run';
    if (values.some((item) => item.status === 'fail')) return 'fail';
    if (values.some((item) => item.status === 'blocked')) return 'blocked';
    if (values.some((item) => item.status === 'unknown')) return 'unknown';
    if (values.some((item) => item.status === 'not-run')) return 'not-run';
    return 'pass';
  }

  stopForHarnessDefect(reason) {
    this.stopped = true;
    this.stopReason = reason;
    this.defect = true;
  }

  totals() {
    return {
      shopperTurns: this.turnKeys.size,
      completionRequests: this.requestIds.size,
      events: { ...this.eventCounts },
      maximumCompletionRequests: this.maximumCompletionRequests,
      stopped: this.stopped,
      stopReason: this.stopReason,
      defect: this.defect,
    };
  }
}

/**
 * Classify one observed /api/chat request within its shopper turn.
 * priorBodies holds the request bodies observed earlier in the same turn.
 * A byte-identical repeat body is a transport retry; a distinct body is a
 * continuation of the same assistant response. Unreadable bodies cannot prove
 * identity, so they stay continuations rather than guessed retries.
 */
export function classifyRequestKind(record, priorBodies) {
  if (record.failed || (record.status !== null && record.status >= 400)) return 'failure';
  if (!priorBodies.length) return 'completion';
  if (record.body !== null && priorBodies.includes(record.body)) return 'retry';
  return 'continuation';
}

/**
 * Completion oracle for one shopper turn. An HTTP 200 (or any transport
 * receipt) alone is never success. The turn completes only when ALL hold:
 * a transport receipt exists; the completed-assistant storage delta (the
 * jtv-concierge-completed-* set the app writes only after a clean finish)
 * contains the EXACT latest assistant ID from the persisted transcript after
 * the current shopper message; and a new assistant message is rendered in
 * the visible rail. Returns 'completed' | 'completed-id-mismatch' |
 * 'id-without-new-message' | 'no-completed-id' | 'stale-reply' | 'no-reply' |
 * 'no-receipt'.
 */
export function evaluateTurnCompletion({
  receiptSeen,
  replyText,
  previousReplyText,
  latestTranscriptAssistantId,
  completedAssistantIds,
  previousCompletedAssistantIds,
  newAssistantMessageRendered,
}) {
  if (!receiptSeen) return 'no-receipt';
  const previous = new Set(previousCompletedAssistantIds ?? []);
  const newCompletedIds = (completedAssistantIds ?? []).filter((id) => !previous.has(id));
  const hasTranscriptId =
    typeof latestTranscriptAssistantId === 'string' && !!latestTranscriptAssistantId;
  if (!hasTranscriptId || !newCompletedIds.includes(latestTranscriptAssistantId)) {
    if (newCompletedIds.length > 0) return 'completed-id-mismatch';
    const replyIsStale =
      previousReplyText !== null &&
      previousReplyText !== undefined &&
      replyText === previousReplyText;
    return replyIsStale ? 'stale-reply' : 'no-completed-id';
  }
  if (typeof replyText !== 'string' || !replyText.trim()) return 'no-reply';
  if (!newAssistantMessageRendered) return 'id-without-new-message';
  return 'completed';
}
