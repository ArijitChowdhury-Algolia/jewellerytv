// Cases: one shopper turn may contain several completion requests; failures and
// retries still count; a missing observation is unknown; the first failure is
// immutable; a harness defect stops the complete campaign.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignLedger } from './accounting.mjs';

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
