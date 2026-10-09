import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyStage4SemanticReview,
  appendStage4CampaignEvent,
  assessCompletedAssistantEvidence,
  beginStage4Case,
  calculateStage4RuntimePin,
  expectedCandidateAgentBehaviorSha256,
  completeStage4Case,
  createStage4Campaign,
  createUniqueStage4RunDirectory,
  decideStage4Request,
  failStage4CaseBeforeExecution,
  nextStage4Case,
  pinStage4AgentSnapshot,
  verifyStage4Pins,
  type CampaignPins,
  type OpeningSemanticReview,
  type RetrievalSemanticReview,
} from './stage4-question-campaign';

/*
Scenario list before implementation:
- Campaign lists the exact eight cases in the approved order and caps 18+12=30.
- A1 mechanical failure stops the campaign and marks later cases not-run.
- A published-agent GET failure stops before sending a shopper message.
- A case cap without a completed assessable outcome fails and stops.
- HTTP 200/partial text without a new completion receipt fails.
- A stale receipt or visible old rail fails even when the old ID exists.
- A new matching completed assistant ID plus new visible reply passes mechanically.
- A mechanically passing case waits for independent review before advancing.
- A failed independent review stops later cases.
- Free-response and consequential binary questions can pass without phrase matching.
- A binary question without a material consequence fails the rubric.
- Category/style menus and compound questions fail even when the review says pass.
- Direct category and exact-item controls require their own retrieval checks.
- Agent snapshot, candidate instruction and runtime pin mismatches are rejected.
- Real snapshot content and runtime source files produce stable pins without network access.
- Unique run directories do not overwrite existing receipts.
- Local chat may pass below cap; cap, open-case retrieval and unknown hosts are blocked.
- Retrieval controls may reach the read-only product evidence route.
- An all-green synthetic review reaches complete with no network or paid calls.
*/

const pins: CampaignPins = {
  candidateInstructionSha256: 'e9251dd09781bd468cd37a6c7e3a3f9d3871914f6eaea13e717c0e313031d693',
  agentId: 'development-agent-id',
  localAgentSnapshotSha256: 'a'.repeat(64),
  agentBehaviorSha256: 'e'.repeat(64),
  runtimeSha256: 'b'.repeat(64),
  harnessSha256: 'd'.repeat(64),
  gitHead: 'c'.repeat(40),
};

function freshCampaign() {
  return createStage4Campaign({
    runId: 'stage4-test-run',
    createdAt: '2026-10-07T00:00:00.000Z',
    pins,
  });
}

function mechanicalPass(completionRequests: number) {
  return {
    completionRequests,
    passed: true,
    failures: [],
    receiptPath: 'cases/canonical-anniversary/receipt.json',
  };
}

function openReview(overrides: Partial<OpeningSemanticReview> = {}): OpeningSemanticReview {
  return {
    reviewerId: 'independent-reviewer',
    verdict: 'pass',
    rubric: {
      personAndOccasionAcknowledged: true,
      statedFactsPreserved: true,
      oneQuestionOneDimension: true,
      noProductCategoryOrStyleMenu: true,
      noRedundantIntake: true,
      replyNotRepeated: true,
    },
    questionForm: 'open',
    binaryQuestionChangesNextStep: null,
    notes: 'Meaning-based review only.',
    ...overrides,
  };
}

function retrievalReview(): RetrievalSemanticReview {
  return {
    reviewerId: 'independent-reviewer',
    verdict: 'pass',
    rubric: {
      explicitRequestHonored: true,
      exactIdentityVerified: true,
      statedConstraintsVerifiedFromFullRecords: true,
      stockClaimsGroundedFromFullRecords: true,
      requestedCountVerified: true,
      noRedundantIntake: true,
    },
    notes: 'Full retrieved records and requested count reviewed.',
  };
}

function passThroughFirstOpening() {
  let campaign = freshCampaign();
  campaign = beginStage4Case(campaign, 'anniversary-canonical', pins);
  campaign = completeStage4Case(campaign, 'anniversary-canonical', mechanicalPass(2));
  campaign = applyStage4SemanticReview(campaign, 'anniversary-canonical', openReview());
  return campaign;
}

describe('Stage 4 question campaign safety harness', () => {
  it('defines the approved eight-case order and exact 3/6/30 request caps', () => {
    const campaign = freshCampaign();
    expect(campaign.cases.map((item) => item.id)).toEqual([
      'anniversary-canonical',
      'anniversary-varied',
      'father-canonical',
      'father-varied',
      'graduation-canonical',
      'graduation-varied',
      'named-category',
      'exact-item-code',
    ]);
    expect(campaign.cases.slice(0, 6).map((item) => item.completionCap)).toEqual(Array(6).fill(3));
    expect(campaign.cases.slice(6).map((item) => item.completionCap)).toEqual([6, 6]);
    expect(campaign.cases.reduce((sum, item) => sum + item.completionCap, 0)).toBe(30);
    expect(nextStage4Case(campaign)?.id).toBe('anniversary-canonical');
  });

  it('stops after a red A1 and marks every later case not-run', () => {
    let campaign = freshCampaign();
    campaign = beginStage4Case(campaign, 'anniversary-canonical', pins);
    campaign = completeStage4Case(campaign, 'anniversary-canonical', {
      completionRequests: 2,
      passed: false,
      failures: ['opening reply offered a category menu'],
      receiptPath: 'cases/anniversary-canonical/receipt.json',
    });
    expect(campaign.status).toBe('failed');
    expect(campaign.firstFailure?.caseId).toBe('anniversary-canonical');
    expect(campaign.cases.slice(1).every((item) => item.status === 'not_run')).toBe(true);
    expect(nextStage4Case(campaign)).toBeNull();
  });

  it('stops before the paid turn when the fresh published-agent GET is unavailable or drifts', () => {
    const campaign = failStage4CaseBeforeExecution(
      freshCampaign(),
      'anniversary-canonical',
      'fresh read-only Agent Studio GET did not match the reviewed candidate',
    );
    expect(campaign.status).toBe('failed');
    expect(campaign.completionRequestsUsed).toBe(0);
    expect(campaign.firstFailure?.caseId).toBe('anniversary-canonical');
    expect(campaign.cases[0].mechanicalFailures).toContain(
      'fresh read-only Agent Studio GET did not match the reviewed candidate',
    );
    expect(campaign.cases.slice(1).every((item) => item.status === 'not_run')).toBe(true);
    expect(nextStage4Case(campaign)).toBeNull();
  });

  it('fails closed when a case reaches its cap without an assessable result', () => {
    let campaign = freshCampaign();
    campaign = beginStage4Case(campaign, 'anniversary-canonical', pins);
    campaign = completeStage4Case(campaign, 'anniversary-canonical', {
      completionRequests: 3,
      passed: false,
      failures: ['completion cap reached before a completed reviewable response'],
      receiptPath: 'cases/anniversary-canonical/receipt.json',
    });
    expect(campaign.status).toBe('failed');
    expect(campaign.firstFailure?.reason).toMatch(/cap|completed/i);
  });

  it('rejects HTTP 200 or partial text without a new completed assistant ID', () => {
    const result = assessCompletedAssistantEvidence({
      completionIdsBefore: [],
      completionIdsAfter: [],
      assistantIdsAfterShopper: ['partial-message'],
      visibleReplyCountBefore: 0,
      visibleReplyCountAfter: 1,
      visibleReplyText: 'Partial streamed text',
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('no new matching completed assistant message ID');
  });

  it('rejects a stale completion ID and unchanged visible rail', () => {
    const result = assessCompletedAssistantEvidence({
      completionIdsBefore: ['old-message'],
      completionIdsAfter: ['old-message'],
      assistantIdsAfterShopper: ['old-message'],
      visibleReplyCountBefore: 1,
      visibleReplyCountAfter: 1,
      visibleReplyText: 'Previously visible reply',
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('no new matching completed assistant message ID');
    expect(result.failures).toContain('no new visible assistant reply');
  });

  it('accepts a new matching completion ID and newly visible reply without phrase matching', () => {
    const result = assessCompletedAssistantEvidence({
      completionIdsBefore: ['old-message'],
      completionIdsAfter: ['old-message', 'new-message'],
      assistantIdsAfterShopper: ['new-message'],
      visibleReplyCountBefore: 1,
      visibleReplyCountAfter: 2,
      visibleReplyText: 'Generated answer of any wording',
    });
    expect(result.passed).toBe(true);
    expect(result.matchingCompletedAssistantIds).toEqual(['new-message']);
  });

  it('does not advance until an independent semantic review passes', () => {
    let campaign = freshCampaign();
    campaign = beginStage4Case(campaign, 'anniversary-canonical', pins);
    campaign = completeStage4Case(campaign, 'anniversary-canonical', mechanicalPass(2));
    expect(campaign.cases[0].status).toBe('awaiting_semantic_review');
    expect(nextStage4Case(campaign)).toBeNull();
    campaign = applyStage4SemanticReview(campaign, 'anniversary-canonical', openReview());
    expect(campaign.cases[0].status).toBe('passed');
    expect(nextStage4Case(campaign)?.id).toBe('anniversary-varied');
  });

  it('accepts a consequential yes/no surprise question without exact wording checks', () => {
    let campaign = passThroughFirstOpening();
    campaign = beginStage4Case(campaign, 'anniversary-varied', pins);
    campaign = completeStage4Case(campaign, 'anniversary-varied', mechanicalPass(2));
    campaign = applyStage4SemanticReview(
      campaign,
      'anniversary-varied',
      openReview({ questionForm: 'binary', binaryQuestionChangesNextStep: true }),
    );
    expect(campaign.cases[1].status).toBe('passed');
  });

  it('rejects a binary question when its answer does not change the next action', () => {
    let campaign = freshCampaign();
    campaign = beginStage4Case(campaign, 'anniversary-canonical', pins);
    campaign = completeStage4Case(campaign, 'anniversary-canonical', mechanicalPass(2));
    campaign = applyStage4SemanticReview(
      campaign,
      'anniversary-canonical',
      openReview({ questionForm: 'binary', binaryQuestionChangesNextStep: false }),
    );
    expect(campaign.status).toBe('failed');
    expect(campaign.firstFailure?.reason).toMatch(/binary|next action/i);
  });

  it('rejects category menus and compound questions even when the review verdict says pass', () => {
    for (const rubric of [
      { ...openReview().rubric, noProductCategoryOrStyleMenu: false },
      { ...openReview().rubric, oneQuestionOneDimension: false },
    ]) {
      let campaign = freshCampaign();
      campaign = beginStage4Case(campaign, 'anniversary-canonical', pins);
      campaign = completeStage4Case(campaign, 'anniversary-canonical', mechanicalPass(2));
      campaign = applyStage4SemanticReview(
        campaign,
        'anniversary-canonical',
        openReview({ rubric }),
      );
      expect(campaign.status).toBe('failed');
    }
  });

  it('requires retrieval-specific identity, constraint and count review for direct requests', () => {
    let campaign = passThroughFirstOpening();
    for (const id of [
      'anniversary-varied',
      'father-canonical',
      'father-varied',
      'graduation-canonical',
      'graduation-varied',
    ] as const) {
      campaign = beginStage4Case(campaign, id, pins);
      campaign = completeStage4Case(campaign, id, mechanicalPass(1));
      campaign = applyStage4SemanticReview(campaign, id, openReview());
    }
    expect(nextStage4Case(campaign)?.id).toBe('named-category');
    campaign = beginStage4Case(campaign, 'named-category', pins);
    campaign = completeStage4Case(campaign, 'named-category', mechanicalPass(4));
    campaign = applyStage4SemanticReview(campaign, 'named-category', retrievalReview());
    expect(nextStage4Case(campaign)?.id).toBe('exact-item-code');
    campaign = beginStage4Case(campaign, 'exact-item-code', pins);
    campaign = completeStage4Case(campaign, 'exact-item-code', mechanicalPass(4));
    campaign = applyStage4SemanticReview(campaign, 'exact-item-code', retrievalReview());
    expect(campaign.status).toBe('complete');
  });

  it('fails direct retrieval review when stock claims are not checked against full records', () => {
    let campaign = passThroughFirstOpening();
    for (const id of [
      'anniversary-varied',
      'father-canonical',
      'father-varied',
      'graduation-canonical',
      'graduation-varied',
    ] as const) {
      campaign = beginStage4Case(campaign, id, pins);
      campaign = completeStage4Case(campaign, id, mechanicalPass(1));
      campaign = applyStage4SemanticReview(campaign, id, openReview());
    }
    campaign = beginStage4Case(campaign, 'named-category', pins);
    campaign = completeStage4Case(campaign, 'named-category', mechanicalPass(4));
    const review = retrievalReview();
    review.rubric.stockClaimsGroundedFromFullRecords = false;
    campaign = applyStage4SemanticReview(campaign, 'named-category', review);
    expect(campaign.status).toBe('failed');
    expect(campaign.firstFailure?.reason).toMatch(/stockClaimsGroundedFromFullRecords/);
  });

  it('stops on failed direct retrieval and does not permit retry or a later case', () => {
    let campaign = passThroughFirstOpening();
    for (const id of [
      'anniversary-varied',
      'father-canonical',
      'father-varied',
      'graduation-canonical',
      'graduation-varied',
      'named-category',
    ] as const) {
      campaign = beginStage4Case(campaign, id, pins);
      campaign = completeStage4Case(campaign, id, mechanicalPass(1));
      campaign = applyStage4SemanticReview(
        campaign,
        id,
        id === 'named-category' ? retrievalReview() : openReview(),
      );
    }
    campaign = beginStage4Case(campaign, 'exact-item-code', pins);
    campaign = completeStage4Case(campaign, 'exact-item-code', {
      completionRequests: 6,
      passed: false,
      failures: ['exact product identity was not established'],
      receiptPath: 'cases/exact-item-code/receipt.json',
    });
    expect(campaign.status).toBe('failed');
    expect(campaign.cases.every((item) => item.status !== 'running')).toBe(true);
    expect(campaign.cases.every((item) => item.status !== 'pending')).toBe(true);
    expect(nextStage4Case(campaign)).toBeNull();
  });

  it('rejects changed runtime, local snapshot, published behavior, agent ID or instruction pins', () => {
    expect(() => verifyStage4Pins(pins, { ...pins })).not.toThrow();
    for (const changed of [
      { ...pins, runtimeSha256: 'd'.repeat(64) },
      { ...pins, localAgentSnapshotSha256: 'f'.repeat(64) },
      { ...pins, agentBehaviorSha256: 'a'.repeat(64) },
      { ...pins, agentId: 'different-agent' },
      { ...pins, candidateInstructionSha256: 'f'.repeat(64) },
    ]) {
      expect(() => verifyStage4Pins(pins, changed)).toThrow(/pin/i);
    }
  });

  it('pins full published behavior while ignoring only updatedAt and lastUsedAt', () => {
    const baselineInstructions = 'previous prompt';
    const candidateInstructions = 'candidate prompt';
    const instructionSha = createHash('sha256').update(candidateInstructions).digest('hex');
    const baselineConfiguration = {
      id: pins.agentId,
      status: 'published',
      instructions: baselineInstructions,
      systemPrompt: 'stable system prompt',
      model: 'example-model',
      updatedAt: 'old timestamp',
      lastUsedAt: 'old use timestamp',
      tools: [{ name: 'retrieve_evidence' }],
    };
    const baselineSnapshot = JSON.stringify({ configuration: baselineConfiguration });
    const expectedBehaviorSha256 = expectedCandidateAgentBehaviorSha256(
      baselineSnapshot,
      candidateInstructions,
      instructionSha,
    );
    const configuration = {
      ...baselineConfiguration,
      instructions: candidateInstructions,
      updatedAt: 'new timestamp',
      lastUsedAt: 'new use timestamp',
    };
    const wrapSnapshot = (config: typeof configuration) =>
      JSON.stringify({
        agentId: pins.agentId,
        hashes: {
          instructions: createHash('sha256')
            .update(JSON.stringify(config.instructions ?? null))
            .digest('hex'),
        },
        configuration: config,
      });
    const raw = wrapSnapshot(configuration);
    const snapshotSha = createHash('sha256').update(raw).digest('hex');
    const expected = {
      expectedSnapshotSha256: snapshotSha,
      expectedAgentId: pins.agentId,
      expectedBehaviorSha256,
      expectedInstructionSha256: instructionSha,
    };
    const result = pinStage4AgentSnapshot(raw, expected);
    expect(result.agentId).toBe(pins.agentId);
    expect(result.agentSnapshotSha256).toBe(snapshotSha);
    expect(result.agentBehaviorSha256).toBe(expectedBehaviorSha256);
    expect(result.candidateInstructionSha256).toBe(instructionSha);
    expect(() => pinStage4AgentSnapshot(raw, { ...expected, expectedSnapshotSha256: 'd'.repeat(64) })).toThrow(/snapshot pin/i);
    expect(() => pinStage4AgentSnapshot(raw, { ...expected, expectedAgentId: 'different-agent' })).toThrow(/agent id/i);
    expect(() => pinStage4AgentSnapshot(raw, { ...expected, expectedBehaviorSha256: 'f'.repeat(64) })).toThrow(/behavior pin/i);

    const changedBehavior = { ...configuration, model: 'different-model' };
    const changedRaw = wrapSnapshot(changedBehavior);
    expect(() =>
      pinStage4AgentSnapshot(changedRaw, {
        ...expected,
        expectedSnapshotSha256: createHash('sha256').update(changedRaw).digest('hex'),
      }),
    ).toThrow(/behavior pin/i);
    const changedInstructions = { ...configuration, instructions: `${candidateInstructions}\n` };
    const changedInstructionsRaw = wrapSnapshot(changedInstructions);
    expect(() =>
      pinStage4AgentSnapshot(changedInstructionsRaw, {
        ...expected,
        expectedSnapshotSha256: createHash('sha256').update(changedInstructionsRaw).digest('hex'),
      }),
    ).toThrow(/instruction pin/i);
  });

  it('hashes sorted app source and refuses a changed runtime pin', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'jtv-stage4-runtime-pin-'));
    try {
      for (const directory of ['storefront/src', 'storefront/shared', 'storefront/server']) {
        mkdirSync(path.join(root, directory), { recursive: true });
        writeFileSync(path.join(root, directory, 'entry.ts'), `export const x = '${directory}';`);
      }
      for (const file of [
        'storefront/vite.config.ts',
        'storefront/package.json',
        'storefront/package-lock.json',
        'storefront/scripts/dev.mjs',
      ]) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), `pin:${file}`);
      }
      const first = calculateStage4RuntimePin(root);
      const second = calculateStage4RuntimePin(root);
      expect(first).toEqual(second);
      expect(first.fileCount).toBe(7);
      expect(first.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(() =>
        verifyStage4Pins(
          { ...pins, runtimeSha256: first.runtimeSha256 },
          { ...pins, runtimeSha256: 'd'.repeat(64) },
        ),
      ).toThrow(/runtimeSha256/);
      writeFileSync(path.join(root, 'storefront/src/entry.ts'), 'changed');
      expect(calculateStage4RuntimePin(root).runtimeSha256).not.toBe(first.runtimeSha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates unique checkpoint run directories without overwriting prior runs', () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'jtv-stage4-campaign-runs-'));
    try {
      const first = createUniqueStage4RunDirectory(parent, '2026-10-07T00-00-00Z');
      const second = createUniqueStage4RunDirectory(parent, '2026-10-07T00-00-00Z');
      expect(first).not.toBe(second);
      expect(readFileSync(path.join(first, '.run-created'), 'utf8')).toMatch(/2026-10-07/);
      expect(readFileSync(path.join(second, '.run-created'), 'utf8')).toMatch(/2026-10-07/);
      appendStage4CampaignEvent(first, { type: 'case-start', caseId: 'anniversary-canonical' });
      appendStage4CampaignEvent(first, { type: 'request-captured', requestNumber: 1 });
      const events = readFileSync(path.join(first, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toHaveLength(2);
      expect(events[1].requestNumber).toBe(1);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('blocks requests at the cap, premature retrieval and non-allowlisted hosts', () => {
    expect(
      decideStage4Request({
        hostAllowed: true,
        kind: 'chat',
        caseKind: 'opening',
        completionRequests: 2,
        completionCap: 3,
        stopRequested: false,
      }),
    ).toEqual({ action: 'continue' });
    expect(
      decideStage4Request({
        hostAllowed: true,
        kind: 'chat',
        caseKind: 'opening',
        completionRequests: 3,
        completionCap: 3,
        stopRequested: false,
      }),
    ).toEqual({ action: 'abort', reason: 'completion_cap' });
    expect(
      decideStage4Request({
        hostAllowed: true,
        kind: 'evidence',
        caseKind: 'opening',
        completionRequests: 1,
        completionCap: 3,
        stopRequested: false,
      }),
    ).toEqual({ action: 'abort', reason: 'premature_retrieval' });
    expect(
      decideStage4Request({
        hostAllowed: true,
        kind: 'evidence',
        caseKind: 'retrieval',
        completionRequests: 1,
        completionCap: 6,
        stopRequested: false,
      }),
    ).toEqual({ action: 'continue' });
    expect(
      decideStage4Request({
        hostAllowed: false,
        kind: 'other',
        caseKind: 'retrieval',
        completionRequests: 0,
        completionCap: 6,
        stopRequested: false,
      }),
    ).toEqual({ action: 'abort', reason: 'off_allowlist' });
  });
});
