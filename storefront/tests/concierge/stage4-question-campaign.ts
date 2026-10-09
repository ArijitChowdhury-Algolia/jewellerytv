import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const STAGE4_QUESTION_CANDIDATE_SHA256 =
  'e9251dd09781bd468cd37a6c7e3a3f9d3871914f6eaea13e717c0e313031d693';

export const STAGE4_QUESTION_CASES = [
  { id: 'anniversary-canonical', kind: 'opening', completionCap: 3 },
  { id: 'anniversary-varied', kind: 'opening', completionCap: 3 },
  { id: 'father-canonical', kind: 'opening', completionCap: 3 },
  { id: 'father-varied', kind: 'opening', completionCap: 3 },
  { id: 'graduation-canonical', kind: 'opening', completionCap: 3 },
  { id: 'graduation-varied', kind: 'opening', completionCap: 3 },
  { id: 'named-category', kind: 'retrieval', completionCap: 6 },
  { id: 'exact-item-code', kind: 'retrieval', completionCap: 6 },
] as const;

export type Stage4CaseId = (typeof STAGE4_QUESTION_CASES)[number]['id'];
export type Stage4CaseKind = 'opening' | 'retrieval';
export type Stage4RequestKind = 'chat' | 'evidence' | 'product' | 'other';
export type Stage4CaseStatus =
  'pending' | 'running' | 'awaiting_semantic_review' | 'passed' | 'failed' | 'not_run';

export type CampaignPins = {
  candidateInstructionSha256: string;
  agentId: string;
  localAgentSnapshotSha256: string;
  agentBehaviorSha256: string;
  runtimeSha256: string;
  harnessSha256: string;
  gitHead: string;
};

export type MechanicalOutcome = {
  completionRequests: number;
  passed: boolean;
  failures: string[];
  receiptPath: string;
};

type ReviewBase = {
  reviewerId: string;
  verdict: 'pass' | 'fail';
  notes: string;
};

export type OpeningSemanticReview = ReviewBase & {
  rubric: {
    personAndOccasionAcknowledged: boolean;
    statedFactsPreserved: boolean;
    oneQuestionOneDimension: boolean;
    noProductCategoryOrStyleMenu: boolean;
    noRedundantIntake: boolean;
    replyNotRepeated: boolean;
  };
  questionForm: 'open' | 'binary' | 'none';
  binaryQuestionChangesNextStep: boolean | null;
};

export type RetrievalSemanticReview = ReviewBase & {
  rubric: {
    explicitRequestHonored: boolean;
    exactIdentityVerified: boolean;
    statedConstraintsVerifiedFromFullRecords: boolean;
    stockClaimsGroundedFromFullRecords: boolean;
    requestedCountVerified: boolean;
    noRedundantIntake: boolean;
  };
};

export type Stage4SemanticReview = OpeningSemanticReview | RetrievalSemanticReview;

export type Stage4CampaignCase = {
  id: Stage4CaseId;
  kind: Stage4CaseKind;
  completionCap: number;
  status: Stage4CaseStatus;
  completionRequests: number;
  startedAt?: string;
  completedAt?: string;
  receiptPath?: string;
  mechanicalFailures?: string[];
  semanticReview?: Stage4SemanticReview;
};

export type Stage4Campaign = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'failed' | 'complete';
  pins: CampaignPins;
  completionRequestCap: 30;
  completionRequestsUsed: number;
  firstFailure: { caseId: Stage4CaseId; reason: string } | null;
  cases: Stage4CampaignCase[];
};

export type AgentSnapshotPin = {
  agentId: string;
  agentSnapshotSha256: string;
  agentBehaviorSha256: string;
  candidateInstructionSha256: string;
};

export function assessCompletedAssistantEvidence(input: {
  completionIdsBefore: string[];
  completionIdsAfter: string[];
  assistantIdsAfterShopper: string[];
  visibleReplyCountBefore: number;
  visibleReplyCountAfter: number;
  visibleReplyText: string;
}): { passed: boolean; failures: string[]; newCompletionIds: string[]; matchingCompletedAssistantIds: string[] } {
  const before = new Set(input.completionIdsBefore);
  const newCompletionIds = input.completionIdsAfter.filter((id) => !before.has(id));
  const assistantIds = new Set(input.assistantIdsAfterShopper);
  const matchingCompletedAssistantIds = newCompletionIds.filter((id) => assistantIds.has(id));
  const failures = [
    ...(matchingCompletedAssistantIds.length
      ? []
      : ['no new matching completed assistant message ID']),
    ...(input.visibleReplyCountAfter > input.visibleReplyCountBefore
      ? []
      : ['no new visible assistant reply']),
    ...(input.visibleReplyText.trim() ? [] : ['new visible assistant reply is empty']),
  ];
  return {
    passed: failures.length === 0,
    failures,
    newCompletionIds,
    matchingCompletedAssistantIds,
  };
}

type AgentSnapshotWrapper = {
  agentId?: string;
  hashes?: { instructions?: string };
  configuration?: Record<string, unknown> & { id?: string; instructions?: unknown };
};

function behaviorValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(behaviorValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== 'updatedAt' && key !== 'lastUsedAt')
      .sort()
      .map((key) => [key, behaviorValue((value as Record<string, unknown>)[key])]),
  );
}

function agentBehaviorHash(configuration: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(behaviorValue(configuration))).digest('hex');
}

function parseAgentSnapshot(snapshotText: string): AgentSnapshotWrapper {
  try {
    return JSON.parse(snapshotText) as AgentSnapshotWrapper;
  } catch {
    throw new Error('Stage 4 agent snapshot is not valid JSON.');
  }
}

export function expectedCandidateAgentBehaviorSha256(
  baselineSnapshotText: string,
  candidateInstructions: string,
  expectedInstructionSha256 = STAGE4_QUESTION_CANDIDATE_SHA256,
): string {
  const actualInstructionSha256 = createHash('sha256').update(candidateInstructions).digest('hex');
  if (actualInstructionSha256 !== expectedInstructionSha256) {
    throw new Error('Candidate instructions do not match the reviewed prompt SHA-256.');
  }
  const baseline = parseAgentSnapshot(baselineSnapshotText).configuration;
  if (!baseline || typeof baseline !== 'object') {
    throw new Error('Baseline snapshot has no full Agent Studio configuration.');
  }
  if (typeof baseline.instructions !== 'string') {
    throw new Error('Baseline Agent Studio configuration has no instruction text.');
  }
  return agentBehaviorHash({ ...baseline, instructions: candidateInstructions });
}

export function decideStage4Request(input: {
  hostAllowed: boolean;
  kind: Stage4RequestKind;
  caseKind: Stage4CaseKind;
  completionRequests: number;
  completionCap: number;
  stopRequested: boolean;
}): { action: 'continue' } | { action: 'abort'; reason: string } {
  if (!input.hostAllowed) return { action: 'abort', reason: 'off_allowlist' };
  if (input.kind === 'chat' && input.stopRequested) {
    return { action: 'abort', reason: 'stop_requested' };
  }
  if (input.kind === 'chat' && input.completionRequests >= input.completionCap) {
    return { action: 'abort', reason: 'completion_cap' };
  }
  if (input.caseKind === 'opening' && (input.kind === 'evidence' || input.kind === 'product')) {
    return { action: 'abort', reason: 'premature_retrieval' };
  }
  return { action: 'continue' };
}

export function pinStage4AgentSnapshot(
  snapshotText: string,
  expected: {
    expectedSnapshotSha256: string;
    expectedAgentId: string;
    expectedBehaviorSha256: string;
    expectedInstructionSha256?: string;
  },
): AgentSnapshotPin {
  const agentSnapshotSha256 = createHash('sha256').update(snapshotText).digest('hex');
  if (agentSnapshotSha256 !== expected.expectedSnapshotSha256) {
    throw new Error('Stage 4 agent snapshot pin mismatch.');
  }
  const snapshot = parseAgentSnapshot(snapshotText);
  const configuration = snapshot.configuration;
  const agentId = configuration?.id ?? snapshot.agentId ?? '';
  if (!agentId || agentId !== expected.expectedAgentId) {
    throw new Error('Stage 4 development agent ID does not match the pinned snapshot.');
  }
  if (typeof configuration?.instructions !== 'string') {
    throw new Error('Stage 4 agent snapshot has no instruction string.');
  }
  const candidateInstructionSha256 = createHash('sha256')
    .update(configuration.instructions)
    .digest('hex');
  const expectedInstructionSha256 =
    expected.expectedInstructionSha256 ?? STAGE4_QUESTION_CANDIDATE_SHA256;
  if (
    candidateInstructionSha256 !== expectedInstructionSha256 ||
    snapshot.hashes?.instructions !==
      createHash('sha256').update(JSON.stringify(configuration.instructions)).digest('hex')
  ) {
    throw new Error('Stage 4 agent instruction pin does not match the reviewed candidate SHA-256.');
  }
  const agentBehaviorSha256 = agentBehaviorHash(configuration);
  if (agentBehaviorSha256 !== expected.expectedBehaviorSha256) {
    throw new Error('Stage 4 published Agent Studio behavior pin mismatch.');
  }
  return { agentId, agentSnapshotSha256, agentBehaviorSha256, candidateInstructionSha256 };
}

function sourceFiles(root: string, directory: string): string[] {
  const absolute = path.join(root, directory);
  if (!statSync(absolute).isDirectory())
    throw new Error(`Runtime source directory missing: ${directory}`);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    const absoluteEntry = path.join(root, relative);
    if (entry.isDirectory()) return sourceFiles(root, relative);
    return /\.(ts|tsx|js|mjs|css|json)$/.test(entry.name) ? [absoluteEntry] : [];
  });
}

export function calculateStage4RuntimePin(repoRoot: string): {
  runtimeSha256: string;
  fileCount: number;
  files: Record<string, string>;
} {
  const files = [
    ...['storefront/src', 'storefront/shared', 'storefront/server'].flatMap((dir) =>
      sourceFiles(repoRoot, dir),
    ),
    ...[
      'storefront/vite.config.ts',
      'storefront/package.json',
      'storefront/package-lock.json',
      'storefront/scripts/dev.mjs',
    ].map((relative) => path.join(repoRoot, relative)),
  ].sort();
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const relative = path.relative(repoRoot, file).split(path.sep).join('/');
    hashes[relative] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  const canonical = Object.entries(hashes)
    .map(([file, hash]) => `${file}\0${hash}\n`)
    .join('');
  return {
    runtimeSha256: createHash('sha256').update(canonical).digest('hex'),
    fileCount: files.length,
    files: hashes,
  };
}

export function calculateStage4HarnessPin(repoRoot: string): {
  harnessSha256: string;
  files: Record<string, string>;
} {
  const paths = [
    'storefront/tests/concierge/stage4-question-campaign.ts',
    'storefront/tests/concierge/stage4-question-campaign.test.ts',
    'storefront/tests/e2e/concierge-stage4-question-campaign.spec.ts',
    'storefront/tests/e2e/concierge-stage4-question-campaign.config.ts',
  ];
  const hashes = Object.fromEntries(
    paths.map((relative) => [
      relative,
      createHash('sha256')
        .update(readFileSync(path.join(repoRoot, relative)))
        .digest('hex'),
    ]),
  );
  const canonical = Object.entries(hashes)
    .map(([file, hash]) => `${file}\0${hash}\n`)
    .join('');
  return {
    harnessSha256: createHash('sha256').update(canonical).digest('hex'),
    files: hashes,
  };
}

export function createUniqueStage4RunDirectory(parent: string, createdAt: string): string {
  mkdirSync(parent, { recursive: true });
  const safeTimestamp = createdAt.replace(/[^a-zA-Z0-9-]/g, '-');
  const runDirectory = mkdtempSync(path.join(parent, `stage4-question-campaign-${safeTimestamp}-`));
  writeFileSync(path.join(runDirectory, '.run-created'), `${createdAt}\n`, { flag: 'wx' });
  return runDirectory;
}

export function appendStage4CampaignEvent(
  runDirectory: string,
  event: Record<string, unknown>,
): void {
  appendFileSync(
    path.join(runDirectory, 'events.jsonl'),
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    { encoding: 'utf8', flag: 'a' },
  );
}

function requireText(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required.`);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isGitHash(value: string): boolean {
  return /^[a-f0-9]{40,64}$/i.test(value);
}

function caseDefinition(caseId: Stage4CaseId) {
  const definition = STAGE4_QUESTION_CASES.find((item) => item.id === caseId);
  if (!definition) throw new Error(`Unknown Stage 4 case: ${caseId}`);
  return definition;
}

function failCampaign(
  campaign: Stage4Campaign,
  caseId: Stage4CaseId,
  reason: string,
  now: string,
): Stage4Campaign {
  const firstFailure = campaign.firstFailure ?? { caseId, reason };
  const cases = campaign.cases.map((item) => {
    if (item.id === caseId) return { ...item, status: 'failed' as const };
    if (item.status === 'pending') return { ...item, status: 'not_run' as const };
    return item;
  });
  return {
    ...campaign,
    status: 'failed',
    updatedAt: now,
    firstFailure,
    cases,
  };
}

export function createStage4Campaign(input: {
  runId: string;
  createdAt: string;
  pins: CampaignPins;
}): Stage4Campaign {
  requireText(input.runId, 'runId');
  verifyStage4Pins(input.pins, input.pins);
  const cases: Stage4CampaignCase[] = STAGE4_QUESTION_CASES.map((item) => ({
    id: item.id,
    kind: item.kind,
    completionCap: item.completionCap,
    status: 'pending',
    completionRequests: 0,
  }));
  const totalCap = cases.reduce((sum, item) => sum + item.completionCap, 0);
  if (totalCap !== 30) throw new Error(`Campaign budget must equal 30, received ${totalCap}.`);
  return {
    schemaVersion: 1,
    runId: input.runId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    status: 'active',
    pins: input.pins,
    completionRequestCap: 30,
    completionRequestsUsed: 0,
    firstFailure: null,
    cases,
  };
}

export function nextStage4Case(campaign: Stage4Campaign): Stage4CampaignCase | null {
  if (campaign.status !== 'active') return null;
  if (
    campaign.cases.some(
      (item) => item.status === 'running' || item.status === 'awaiting_semantic_review',
    )
  ) {
    return null;
  }
  return campaign.cases.find((item) => item.status === 'pending') ?? null;
}

export function beginStage4Case(
  campaign: Stage4Campaign,
  caseId: Stage4CaseId,
  actualPins: CampaignPins,
  now = new Date().toISOString(),
): Stage4Campaign {
  if (campaign.status !== 'active')
    throw new Error('Campaign is closed; no retry or later case is allowed.');
  verifyStage4Pins(campaign.pins, actualPins);
  const next = nextStage4Case(campaign);
  if (!next || next.id !== caseId) {
    throw new Error(`Case ${caseId} is not the next review-cleared case.`);
  }
  return {
    ...campaign,
    updatedAt: now,
    cases: campaign.cases.map((item) =>
      item.id === caseId ? { ...item, status: 'running', startedAt: now } : item,
    ),
  };
}

export function failStage4CaseBeforeExecution(
  campaign: Stage4Campaign,
  caseId: Stage4CaseId,
  reason: string,
  now = new Date().toISOString(),
): Stage4Campaign {
  const next = nextStage4Case(campaign);
  if (!next || next.id !== caseId) {
    throw new Error(`Case ${caseId} is not the next case eligible for a preflight failure.`);
  }
  requireText(reason, 'preflight failure reason');
  const cases = campaign.cases.map((item) => {
    if (item.id === caseId) {
      return { ...item, status: 'failed' as const, completedAt: now, mechanicalFailures: [reason] };
    }
    if (item.status === 'pending') return { ...item, status: 'not_run' as const };
    return item;
  });
  return {
    ...campaign,
    updatedAt: now,
    status: 'failed',
    firstFailure: campaign.firstFailure ?? { caseId, reason },
    cases,
  };
}

export function completeStage4Case(
  campaign: Stage4Campaign,
  caseId: Stage4CaseId,
  outcome: MechanicalOutcome,
  now = new Date().toISOString(),
): Stage4Campaign {
  const item = campaign.cases.find((entry) => entry.id === caseId);
  if (campaign.status !== 'active' || item?.status !== 'running') {
    throw new Error(`Case ${caseId} is not running.`);
  }
  const definition = caseDefinition(caseId);
  const validCount =
    Number.isSafeInteger(outcome.completionRequests) && outcome.completionRequests > 0;
  const overCap = !validCount || outcome.completionRequests > definition.completionCap;
  const totalUsed = campaign.completionRequestsUsed + (validCount ? outcome.completionRequests : 0);
  const campaignOverCap = totalUsed > campaign.completionRequestCap;
  const failures = [
    ...outcome.failures,
    ...(!validCount ? ['no valid completion request was captured'] : []),
    ...(overCap ? [`case completion cap ${definition.completionCap} exceeded or exhausted`] : []),
    ...(campaignOverCap ? ['campaign completion cap 30 exceeded'] : []),
    ...(!outcome.passed ? [] : []),
  ];
  if (!outcome.passed || failures.length > 0) {
    const failed = {
      ...campaign,
      completionRequestsUsed: totalUsed,
      cases: campaign.cases.map((entry) =>
        entry.id === caseId
          ? {
              ...entry,
              completionRequests: validCount ? outcome.completionRequests : 0,
              completedAt: now,
              receiptPath: outcome.receiptPath,
              mechanicalFailures: failures.length ? failures : ['mechanical gate failed'],
            }
          : entry,
      ),
    };
    return failCampaign(failed, caseId, failures.join('; ') || 'mechanical gate failed', now);
  }
  return {
    ...campaign,
    updatedAt: now,
    completionRequestsUsed: totalUsed,
    cases: campaign.cases.map((entry) =>
      entry.id === caseId
        ? {
            ...entry,
            status: 'awaiting_semantic_review',
            completionRequests: outcome.completionRequests,
            completedAt: now,
            receiptPath: outcome.receiptPath,
            mechanicalFailures: [],
          }
        : entry,
    ),
  };
}

function reviewFailures(caseItem: Stage4CampaignCase, review: Stage4SemanticReview): string[] {
  if (!review.reviewerId.trim() || /runner|automation|harness/i.test(review.reviewerId)) {
    return ['independent reviewer identity is missing or matches the runner'];
  }
  if (review.verdict !== 'pass')
    return [review.notes.trim() || 'independent semantic review failed'];
  if (caseItem.kind === 'opening') {
    const opening = review as OpeningSemanticReview;
    const required = [
      'personAndOccasionAcknowledged',
      'statedFactsPreserved',
      'oneQuestionOneDimension',
      'noProductCategoryOrStyleMenu',
      'noRedundantIntake',
      'replyNotRepeated',
    ] as const;
    const failedRubric = required.filter((name) => opening.rubric?.[name] !== true);
    const questionFail =
      opening.questionForm === 'none' ||
      (opening.questionForm === 'binary' && opening.binaryQuestionChangesNextStep !== true);
    return [
      ...failedRubric,
      ...(questionFail ? ['question form is absent or an unneeded binary question'] : []),
    ];
  }
  const retrieval = review as RetrievalSemanticReview;
  const required = [
    'explicitRequestHonored',
    'exactIdentityVerified',
    'statedConstraintsVerifiedFromFullRecords',
    'stockClaimsGroundedFromFullRecords',
    'requestedCountVerified',
    'noRedundantIntake',
  ] as const;
  return required.filter((name) => retrieval.rubric?.[name] !== true);
}

export function applyStage4SemanticReview(
  campaign: Stage4Campaign,
  caseId: Stage4CaseId,
  review: Stage4SemanticReview,
  now = new Date().toISOString(),
): Stage4Campaign {
  const current = campaign.cases.find((item) => item.id === caseId);
  if (campaign.status !== 'active' || current?.status !== 'awaiting_semantic_review') {
    throw new Error(`Case ${caseId} is not awaiting semantic review.`);
  }
  const failures = reviewFailures(current, review);
  if (failures.length) {
    const withReview = {
      ...campaign,
      cases: campaign.cases.map((item) =>
        item.id === caseId ? { ...item, semanticReview: review } : item,
      ),
    };
    return failCampaign(withReview, caseId, failures.join('; '), now);
  }
  const cases = campaign.cases.map((item) =>
    item.id === caseId ? { ...item, semanticReview: review, status: 'passed' as const } : item,
  );
  const allPassed = cases.every((item) => item.status === 'passed');
  return {
    ...campaign,
    updatedAt: now,
    status: allPassed ? 'complete' : 'active',
    cases,
  };
}

export function verifyStage4Pins(expected: CampaignPins, actual: CampaignPins): void {
  const requiredKeys: Array<keyof CampaignPins> = [
    'candidateInstructionSha256',
    'agentId',
    'localAgentSnapshotSha256',
    'agentBehaviorSha256',
    'runtimeSha256',
    'harnessSha256',
    'gitHead',
  ];
  for (const key of requiredKeys) {
    const wanted = expected[key];
    const received = actual[key];
    requireText(wanted, `expected ${key}`);
    requireText(received, `actual ${key}`);
    if (wanted !== received) throw new Error(`Stage 4 source pin mismatch: ${key}.`);
  }
  if (
    !isSha256(expected.candidateInstructionSha256) ||
    expected.candidateInstructionSha256 !== STAGE4_QUESTION_CANDIDATE_SHA256
  ) {
    throw new Error('Stage 4 candidate instruction pin does not match the reviewed SHA-256.');
  }
  if (
    !isSha256(expected.localAgentSnapshotSha256) ||
    !isSha256(expected.agentBehaviorSha256) ||
    !isSha256(expected.runtimeSha256) ||
    !isSha256(expected.harnessSha256)
  ) {
    throw new Error('Stage 4 local readback, published behavior, runtime and harness pins must be SHA-256 values.');
  }
  if (!isGitHash(expected.gitHead)) throw new Error('Stage 4 gitHead pin is malformed.');
}
