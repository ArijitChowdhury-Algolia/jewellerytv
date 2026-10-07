// Cases: one shopper turn may contain several completion requests; failures and
// retries still count; a missing observation is unknown; the first failure is
// immutable; a harness defect stops the complete campaign.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignLedger, classifyRequestKind, evaluateTurnCompletion } from './accounting.mjs';

test('counts shopper turns separately from completion continuations', () => {
  const ledger = new CampaignLedger({ maximumCompletionRequests: 5 });
  ledger.startTurn('journey-a', 'one');
  ledger.recordRequest('journey-a', 'one', 'completion', 'request-a');
  ledger.recordRequest('journey-a', 'one', 'continuation', 'request-b');
  ledger.startTurn('journey-a', 'two');
  ledger.recordRequest('journey-a', 'two', 'failure', 'request-c');
  const totals = ledger.totals();
  assert.equal(totals.shopperTurns, 2);
  assert.equal(totals.completionRequests, 3);
  assert.equal(totals.events.failure, 1);
});

test('keeps first failure and never promotes unknown or blocked to pass', () => {
  const ledger = new CampaignLedger({ maximumCompletionRequests: 5 });
  ledger.recordAssertion('a', 'grounding', 'unknown', 'No source returned');
  ledger.recordAssertion('a', 'continuity', 'blocked', 'Guardrail stopped turn');
  ledger.recordAssertion('a', 'grounding', 'fail', 'Unsupported claim');
  ledger.recordAssertion('a', 'grounding', 'pass', 'Later retry');
  assert.equal(ledger.firstFailure('a').detail, 'Unsupported claim');
  assert.equal(ledger.assertions('a').grounding.status, 'fail');
  assert.equal(ledger.assertions('a').continuity.status, 'blocked');
  assert.equal(ledger.verdict('a'), 'fail');
});

test('deduplicates observed requests but charges retries and overrun', () => {
  const ledger = new CampaignLedger({ maximumCompletionRequests: 2 });
  ledger.startTurn('a', 'one');
  ledger.recordRequest('a', 'one', 'completion', 'r1');
  ledger.recordRequest('a', 'one', 'completion', 'r1');
  ledger.recordRequest('a', 'one', 'retry', 'r2');
  assert.equal(ledger.totals().completionRequests, 2);
  assert.throws(() => ledger.recordRequest('a', 'one', 'failure', 'r3'), /budget exceeded/);
  assert.equal(ledger.totals().completionRequests, 3);
  assert.equal(ledger.stopped, true);
});

test('harness defect stops every subsequent journey', () => {
  const ledger = new CampaignLedger({ maximumCompletionRequests: 5 });
  ledger.stopForHarnessDefect('Missing known assertion evaluator');
  assert.throws(() => ledger.startTurn('next', 'one'), /campaign stopped/);
  assert.equal(ledger.verdict('next'), 'not-run');
});

test('budget exhaustion is a controlled stop, not a harness defect', () => {
  const ledger = new CampaignLedger({ maximumCompletionRequests: 1 });
  ledger.startTurn('a', 'one');
  ledger.recordRequest('a', 'one', 'completion', 'r1');
  assert.throws(
    () => ledger.recordRequest('a', 'one', 'continuation', 'r2'),
    /remaining cases unexecuted/,
  );
  assert.equal(ledger.stopped, true);
  assert.equal(ledger.defect, false, 'a spent budget is not a harness defect');
  assert.match(ledger.stopReason, /remaining cases unexecuted/);
});

test('stopForHarnessDefect marks the run as defective, distinct from a spent budget', () => {
  const ledger = new CampaignLedger({ maximumCompletionRequests: 5 });
  ledger.stopForHarnessDefect('Broken assertion evaluator');
  assert.equal(ledger.stopped, true);
  assert.equal(ledger.defect, true);
});

test('retries consume budget, do not create shopper turns, and are capped at one per turn', () => {
  const ledger = new CampaignLedger({ maximumCompletionRequests: 5 });
  ledger.startTurn('a', 'one');
  ledger.recordRequest('a', 'one', 'completion', 'r1');
  ledger.startRetry('a', 'one');
  ledger.recordRequest('a', 'one', 'retry', 'r2');
  assert.equal(ledger.totals().shopperTurns, 1);
  assert.equal(ledger.totals().completionRequests, 2);
  assert.equal(ledger.totals().events.retry, 1);
  assert.throws(() => ledger.startRetry('a', 'one'), /one transport retry/);
  assert.throws(() => ledger.startRetry('a', 'missing'), /no shopper turn/);
});

test('classifyRequestKind separates completions, continuations, retries and failures', () => {
  assert.equal(classifyRequestKind({ body: 'a', status: 200, failed: false }, []), 'completion');
  assert.equal(
    classifyRequestKind({ body: 'b', status: 200, failed: false }, ['a']),
    'continuation',
  );
  assert.equal(classifyRequestKind({ body: 'a', status: 200, failed: false }, ['a']), 'retry');
  assert.equal(classifyRequestKind({ body: 'c', status: 500, failed: false }, ['a']), 'failure');
  assert.equal(classifyRequestKind({ body: null, status: null, failed: true }, ['a']), 'failure');
});

test('classifyRequestKind: unreadable bodies cannot prove identity, so repeats stay continuations', () => {
  assert.equal(
    classifyRequestKind({ body: null, status: 200, failed: false }, [null]),
    'continuation',
  );
});

test('completion oracle rejects HTTP 200 plus partial new text with no new completed ID', () => {
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: true,
      replyText: 'partial new text from a broken stream',
      previousReplyText: 'earlier reply',
      latestTranscriptAssistantId: null,
      completedAssistantIds: ['assistant-old'],
      previousCompletedAssistantIds: ['assistant-old'],
      newAssistantMessageRendered: true,
    }),
    'no-completed-id',
  );
});

test('completion oracle rejects an old rail plus an old completed ID', () => {
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: true,
      replyText: 'same old reply',
      previousReplyText: 'same old reply',
      latestTranscriptAssistantId: 'assistant-old',
      completedAssistantIds: ['assistant-old'],
      previousCompletedAssistantIds: ['assistant-old'],
      newAssistantMessageRendered: false,
    }),
    'stale-reply',
  );
});

test('completion oracle accepts identical reply text with a genuinely new completed ID', () => {
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: true,
      replyText: 'same old reply',
      previousReplyText: 'same old reply',
      latestTranscriptAssistantId: 'assistant-new',
      completedAssistantIds: ['assistant-old', 'assistant-new'],
      previousCompletedAssistantIds: ['assistant-old'],
      newAssistantMessageRendered: true,
    }),
    'completed',
  );
});

test('completion oracle requires a new completed reply, and a first reply completes', () => {
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: true,
      replyText: 'fresh answer',
      previousReplyText: 'same old reply',
      latestTranscriptAssistantId: 'assistant-new',
      completedAssistantIds: ['assistant-new'],
      previousCompletedAssistantIds: [],
      newAssistantMessageRendered: true,
    }),
    'completed',
  );
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: true,
      replyText: 'first answer',
      previousReplyText: null,
      latestTranscriptAssistantId: 'assistant-new',
      completedAssistantIds: ['assistant-new'],
      previousCompletedAssistantIds: [],
      newAssistantMessageRendered: true,
    }),
    'completed',
  );
});

test('completion oracle never passes without a receipt or without any reply text', () => {
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: false,
      replyText: 'looks done',
      previousReplyText: null,
      latestTranscriptAssistantId: 'assistant-new',
      completedAssistantIds: ['assistant-new'],
      previousCompletedAssistantIds: [],
      newAssistantMessageRendered: true,
    }),
    'no-receipt',
  );
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: true,
      replyText: null,
      previousReplyText: null,
      latestTranscriptAssistantId: 'assistant-new',
      completedAssistantIds: ['assistant-new'],
      previousCompletedAssistantIds: [],
      newAssistantMessageRendered: true,
    }),
    'no-reply',
  );
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: true,
      replyText: '',
      previousReplyText: null,
      latestTranscriptAssistantId: null,
      completedAssistantIds: [],
      previousCompletedAssistantIds: [],
      newAssistantMessageRendered: false,
    }),
    'no-completed-id',
  );
});

test('completion oracle rejects a completed ID with no newly rendered rail message', () => {
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: true,
      replyText: 'some new text',
      previousReplyText: 'earlier reply',
      latestTranscriptAssistantId: 'assistant-new',
      completedAssistantIds: ['assistant-old', 'assistant-new'],
      previousCompletedAssistantIds: ['assistant-old'],
      newAssistantMessageRendered: false,
    }),
    'id-without-new-message',
  );
});

test('completion oracle rejects a completed ID that is not the exact latest transcript assistant ID', () => {
  assert.equal(
    evaluateTurnCompletion({
      receiptSeen: true,
      replyText: 'some new text',
      previousReplyText: 'earlier reply',
      latestTranscriptAssistantId: 'assistant-transcript-latest',
      completedAssistantIds: ['assistant-old', 'assistant-some-other-new'],
      previousCompletedAssistantIds: ['assistant-old'],
      newAssistantMessageRendered: true,
    }),
    'completed-id-mismatch',
  );
});
