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
      this.stopForHarnessDefect('completion request budget exceeded');
      throw new Error('Completion request budget exceeded.');
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
  }

  totals() {
    return {
      shopperTurns: this.turnKeys.size,
      completionRequests: this.requestIds.size,
      events: { ...this.eventCounts },
      maximumCompletionRequests: this.maximumCompletionRequests,
      stopped: this.stopped,
      stopReason: this.stopReason,
    };
  }
}
