/*
 * Stage 4 eight-case finite campaign. Opt-in only, and one fresh mission per
 * invocation. A mechanically green case pauses for an independent semantic
 * review before another case can run. No expected answer prose is stored.
 *
 * No-paid checks:
 *   npm test -- tests/concierge/stage4-question-campaign.test.ts
 *
 * Live execution stays disabled until the Controller authorizes it and supplies
 * the saved-agent, runtime and Git pins. This file does not change Agent Studio.
 */
import { expect, test, type Request } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../server/config';
import {
  appendStage4CampaignEvent,
  applyStage4SemanticReview,
  beginStage4Case,
  calculateStage4HarnessPin,
  calculateStage4RuntimePin,
  completeStage4Case,
  createStage4Campaign,
  createUniqueStage4RunDirectory,
  decideStage4Request,
  expectedCandidateAgentBehaviorSha256,
  failStage4CaseBeforeExecution,
  nextStage4Case,
  pinStage4AgentSnapshot,
  STAGE4_QUESTION_CASES,
  verifyStage4Pins,
  type CampaignPins,
  type Stage4Campaign,
  type Stage4CaseId,
} from '../concierge/stage4-question-campaign';

const live = process.env.JTV_RUN_STAGE4_QUESTION_CAMPAIGN === '1';
const caseText: Record<Stage4CaseId, string> = {
  'anniversary-canonical':
    "I want to buy a gift for my wife for our 10th anniversary, but I don't know where to start. She likes white gold and restrained designs. Nothing flashy, just a classy, timeless piece. My budget is $500. Help me.",
  'anniversary-varied':
    "We're celebrating ten years married. My wife likes white gold and understated things, nothing flashy. I have up to $500, but I'm unsure what feels like her.",
  'father-canonical':
    "Father's Day is coming up. Dad always says not to get him anything, but he's always been there for me. He loves watches, and I want to get him one he'd actually wear. I have no idea where to begin.",
  'father-varied':
    "Dad insists he needs nothing, but he has always shown up for us. He wears watches and I'd like to thank him with one he'd use. I'm stuck on where to begin.",
  'graduation-canonical':
    "My daughter is graduating next month. I'm so proud of her. I'd love to get her jewellery she'll still want to wear a year from now, not something that just says 'graduation'.",
  'graduation-varied':
    "My daughter finishes school soon, and I'm proud of everything she has put into it. I want a lasting gift, not a graduation trinket, but I'm not sure where to start.",
  'named-category': 'Show me three simple 14K white-gold stud earrings under $500, with no hearts.',
  'exact-item-code': 'Show me item VG273B.',
};

type NetworkReceipt = {
  sequence: number;
  url: string;
  method: string;
  requestBody: string | null;
  status: number | null;
  responseBodyFile: string | null;
  responseError: string | null;
  networkFailure: string | null;
  at: string;
};

type RuntimePins = {
  pins: CampaignPins;
  runtimeFiles: Record<string, string>;
  harnessFiles: Record<string, string>;
  localAgentSnapshotPath: string;
  expectedAgentBehaviorSha256: string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required source pin: ${name}.`);
  return value;
}

function parseDevelopmentAgentId(repoRoot: string): string {
  const envPath = path.join(repoRoot, '.env.local');
  const contents = fs.readFileSync(envPath, 'utf8');
  const match = contents.match(/^\s*JTV_CONCIERGE_DEVELOPMENT_AGENT_ID\s*=\s*(.*?)\s*$/m);
  const agentId = match?.[1]?.replace(/^(['"])(.*)\1$/, '$2') ?? '';
  if (!agentId) throw new Error('Root .env.local has no development agent ID.');
  return agentId;
}

function gitHead(repoRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function latestSavedSnapshot(repoRoot: string): string {
  const evidenceDirectory = path.join(repoRoot, 'storefront', 'evidence');
  const names = fs
    .readdirSync(evidenceDirectory)
    .filter((name) => /^agent-\d{4}-\d{2}-\d{2}T.*\.json$/.test(name))
    .sort();
  if (!names.length)
    throw new Error('No saved Agent Studio readback exists in storefront/evidence.');
  return path.join(evidenceDirectory, names[names.length - 1]);
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readRuntimePins(repoRoot: string): RuntimePins {
  const agentSnapshotPath = path.resolve(repoRoot, requiredEnvironment('JTV_STAGE4_AGENT_SNAPSHOT'));
  if (agentSnapshotPath !== path.resolve(latestSavedSnapshot(repoRoot))) {
    throw new Error('Agent snapshot must be the latest saved readback in storefront/evidence.');
  }
  const candidateDirectory = path.join(
    repoRoot,
    '.checkpoint/runs/stage4-question-method-candidate-2026-10-07',
  );
  const candidateInstructions = fs.readFileSync(
    path.join(candidateDirectory, 'candidate-instructions.txt'),
    'utf8',
  );
  const rollbackInstructions = fs.readFileSync(
    path.join(candidateDirectory, 'rollback-instructions-12-24.txt'),
    'utf8',
  );
  const rollbackSnapshotText = fs.readFileSync(
    path.join(candidateDirectory, 'rollback-agent-12-24.json'),
    'utf8',
  );
  const candidateManifest = JSON.parse(
    fs.readFileSync(path.join(candidateDirectory, 'manifest.json'), 'utf8'),
  );
  if (
    hashText(candidateInstructions) !== STAGE4_QUESTION_CANDIDATE_SHA256 ||
    hashText(candidateInstructions) !== candidateManifest.candidate?.sha256
  ) {
    throw new Error('Local candidate prompt does not match the Controller-reviewed SHA-256.');
  }
  if (hashText(rollbackInstructions) !== candidateManifest.baseline?.instructionSha256) {
    throw new Error('Exact rollback instruction payload does not match the candidate manifest.');
  }
  if (hashText(rollbackSnapshotText) !== candidateManifest.baseline?.snapshotSha256) {
    throw new Error('Exact rollback Agent Studio snapshot does not match the candidate manifest.');
  }
  const rollbackSnapshot = JSON.parse(rollbackSnapshotText);
  if (rollbackSnapshot.configuration?.instructions !== rollbackInstructions) {
    throw new Error('Rollback snapshot instructions differ from the exact rollback payload.');
  }
  const expectedAgentBehaviorSha256 = expectedCandidateAgentBehaviorSha256(
    rollbackSnapshotText,
    candidateInstructions,
  );
  const localAgentSnapshot = fs.readFileSync(agentSnapshotPath, 'utf8');
  const developmentAgentId = parseDevelopmentAgentId(repoRoot);
  const localAgentPin = pinStage4AgentSnapshot(localAgentSnapshot, {
    expectedSnapshotSha256: requiredEnvironment('JTV_STAGE4_AGENT_SNAPSHOT_SHA256'),
    expectedAgentId: developmentAgentId,
    expectedBehaviorSha256: expectedAgentBehaviorSha256,
  });
  const runtime = calculateStage4RuntimePin(repoRoot);
  const runtimeSha256 = requiredEnvironment('JTV_STAGE4_RUNTIME_SHA256');
  if (runtime.runtimeSha256 !== runtimeSha256) {
    throw new Error('Local app runtime does not match JTV_STAGE4_RUNTIME_SHA256.');
  }
  const harness = calculateStage4HarnessPin(repoRoot);
  const harnessSha256 = requiredEnvironment('JTV_STAGE4_HARNESS_SHA256');
  if (harness.harnessSha256 !== harnessSha256) {
    throw new Error('Stage 4 harness files do not match JTV_STAGE4_HARNESS_SHA256.');
  }
  const actualGitHead = gitHead(repoRoot);
  const expectedGitHead = requiredEnvironment('JTV_STAGE4_GIT_HEAD');
  if (actualGitHead !== expectedGitHead) throw new Error('Local Git HEAD does not match its pin.');
  const expectedAgentId = requiredEnvironment('JTV_STAGE4_AGENT_ID');
  if (developmentAgentId !== expectedAgentId) {
    throw new Error('JTV_STAGE4_AGENT_ID differs from the development agent in .env.local.');
  }
  return {
    localAgentSnapshotPath: agentSnapshotPath,
    runtimeFiles: runtime.files,
    harnessFiles: harness.files,
    expectedAgentBehaviorSha256,
    pins: {
      candidateInstructionSha256: localAgentPin.candidateInstructionSha256,
      agentId: localAgentPin.agentId,
      localAgentSnapshotSha256: localAgentPin.agentSnapshotSha256,
      agentBehaviorSha256: localAgentPin.agentBehaviorSha256,
      runtimeSha256: runtime.runtimeSha256,
      harnessSha256: harness.harnessSha256,
      gitHead: actualGitHead,
    },
  };
}

async function readFreshPublishedAgent(
  agentId: string,
  expectedBehaviorSha256: string,
): Promise<{ status: number; snapshotText: string; pin: ReturnType<typeof pinStage4AgentSnapshot> }> {
  const { appId, apiKey } = loadConfig();
  const response = await fetch(`https://${appId}.algolia.net/agent-studio/1/agents/${agentId}`, {
    headers: {
      'x-algolia-application-id': appId,
      'x-algolia-api-key': apiKey,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Fresh read-only Agent Studio GET failed (${response.status}).`);
  const configuration = await response.json();
  const serializedConfiguration = JSON.stringify(configuration, null, 2);
  if (serializedConfiguration.includes(apiKey)) {
    throw new Error('Fresh Agent Studio readback rejected because it contains the configured API key.');
  }
  const configObject = configuration as Record<string, unknown>;
  const fieldHash = (value: unknown) => hashText(JSON.stringify(value ?? null));
  const snapshot = {
    capturedAt: new Date().toISOString(),
    agentId,
    hashes: {
      instructions: fieldHash(configObject.instructions),
      systemPrompt: fieldHash(configObject.systemPrompt),
      config: fieldHash(configObject.config),
      tools: fieldHash(configObject.tools),
    },
    sha256: hashText(serializedConfiguration),
    configuration,
  };
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const pin = pinStage4AgentSnapshot(snapshotText, {
    expectedSnapshotSha256: hashText(snapshotText),
    expectedAgentId: agentId,
    expectedBehaviorSha256,
  });
  return { status: response.status, snapshotText, pin };
}

function campaignRoot(repoRoot: string): string {
  const allowed = path.resolve(repoRoot, '.checkpoint', 'runs');
  const configured = process.env.JTV_STAGE4_CAMPAIGN_DIR;
  if (!configured) return createUniqueStage4RunDirectory(allowed, new Date().toISOString());
  const resolved = path.resolve(repoRoot, configured);
  if (!resolved.startsWith(`${allowed}${path.sep}`)) {
    throw new Error('Campaign output must be a new run directory under .checkpoint/runs.');
  }
  if (!fs.existsSync(resolved)) throw new Error('Configured campaign directory does not exist.');
  return resolved;
}

function caseOutputDirectory(runDir: string, caseId: Stage4CaseId): string {
  const ordinal = STAGE4_QUESTION_CASES.findIndex((item) => item.id === caseId);
  if (ordinal < 0) throw new Error(`Unknown Stage 4 case: ${caseId}`);
  return path.join(runDir, 'cases', `${String(ordinal + 1).padStart(2, '0')}-${caseId}`);
}

function writeJson(pathname: string, value: unknown): void {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  const temporary = `${pathname}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, pathname);
}

function saveCampaign(runDir: string, campaign: Stage4Campaign): void {
  writeJson(path.join(runDir, 'campaign.json'), campaign);
}

function writeReviewTemplate(runDir: string, caseId: Stage4CaseId): string {
  const definition = STAGE4_QUESTION_CASES.find((item) => item.id === caseId);
  if (!definition) throw new Error(`Unknown Stage 4 case ${caseId}.`);
  const caseDir = caseOutputDirectory(runDir, caseId);
  const pathname = path.join(caseDir, 'semantic-review.template.json');
  const opening = definition.kind === 'opening';
  const review = opening
    ? {
        reviewerId: '',
        verdict: 'fail',
        rubric: {
          personAndOccasionAcknowledged: false,
          statedFactsPreserved: false,
          oneQuestionOneDimension: false,
          noProductCategoryOrStyleMenu: false,
          noRedundantIntake: false,
          replyNotRepeated: false,
        },
        questionForm: 'none',
        binaryQuestionChangesNextStep: null,
        notes:
          'Replace this template after an independent meaning-based review. Do not match exact wording.',
      }
    : {
        reviewerId: '',
        verdict: 'fail',
        rubric: {
          explicitRequestHonored: false,
          exactIdentityVerified: false,
          statedConstraintsVerifiedFromFullRecords: false,
          stockClaimsGroundedFromFullRecords: false,
          requestedCountVerified: false,
          noRedundantIntake: false,
        },
        notes: 'Inspect full retrieved records and visible cards, then replace this template.',
      };
  if (!fs.existsSync(pathname)) writeJson(pathname, review);
  return pathname;
}

function applyPendingReview(runDir: string, campaign: Stage4Campaign) {
  const waiting = campaign.cases.find((item) => item.status === 'awaiting_semantic_review');
  if (!waiting) return { campaign, waitingForReview: null as string | null };
  const reviewPath = path.join(caseOutputDirectory(runDir, waiting.id), 'semantic-review.json');
  if (!fs.existsSync(reviewPath)) {
    const template = writeReviewTemplate(runDir, waiting.id);
    return { campaign, waitingForReview: template };
  }
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  const reviewed = applyStage4SemanticReview(campaign, waiting.id, review);
  saveCampaign(runDir, reviewed);
  appendStage4CampaignEvent(runDir, {
    type: 'semantic-review-applied',
    caseId: waiting.id,
    reviewPath: path.relative(runDir, reviewPath),
    status: reviewed.cases.find((item) => item.id === waiting.id)?.status,
    firstFailure: reviewed.firstFailure,
  });
  if (reviewed.status === 'failed') {
    throw new Error(`Independent review stopped the campaign: ${reviewed.firstFailure?.reason}.`);
  }
  return { campaign: reviewed, waitingForReview: null as string | null };
}

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isLocalOrApprovedReadHost(url: URL): boolean {
  return (
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    ['images.jtv.com', 'www.jtv.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(
      url.hostname,
    )
  );
}

function requestKind(url: string): 'chat' | 'evidence' | 'product' | 'other' {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/chat') return 'chat';
  if (pathname.startsWith('/api/agent-evidence')) return 'evidence';
  if (pathname.startsWith('/api/products/') || pathname.startsWith('/api/agent-product-refresh')) {
    return 'product';
  }
  return 'other';
}

test('Stage 4 question campaign runs only the next review-cleared case', async ({ page }) => {
  test.skip(
    !live,
    'Paid/browser campaign is disabled unless Controller authorizes JTV_RUN_STAGE4_QUESTION_CAMPAIGN=1.',
  );
  test.setTimeout(8 * 60_000);
  const repoRoot = path.resolve(process.cwd(), '..');
  const startPins = readRuntimePins(repoRoot);
  const runDir = campaignRoot(repoRoot);
  const campaignPath = path.join(runDir, 'campaign.json');
  let campaign: Stage4Campaign;
  if (fs.existsSync(campaignPath)) {
    campaign = JSON.parse(fs.readFileSync(campaignPath, 'utf8')) as Stage4Campaign;
    verifyStage4Pins(campaign.pins, startPins.pins);
  } else {
    if (process.env.JTV_STAGE4_CAMPAIGN_DIR) {
      throw new Error(
        'Refusing to initialize over a configured campaign directory without campaign.json.',
      );
    }
    campaign = createStage4Campaign({
      runId: path.basename(runDir),
      createdAt: new Date().toISOString(),
      pins: startPins.pins,
    });
    writeJson(campaignPath, campaign);
    writeJson(path.join(runDir, 'pins', 'initial.json'), {
      pins: startPins.pins,
      runtimeFiles: startPins.runtimeFiles,
      agentSnapshotPath: path.relative(repoRoot, startPins.agentSnapshotPath),
    });
    appendStage4CampaignEvent(runDir, { type: 'campaign-created', pins: startPins.pins });
    console.log(`Stage 4 campaign created: ${path.relative(repoRoot, runDir)}`);
  }

  const reviewed = applyPendingReview(runDir, campaign);
  campaign = reviewed.campaign;
  if (reviewed.waitingForReview) {
    test.skip(
      true,
      `Waiting for independent semantic review in ${path.relative(runDir, reviewed.waitingForReview)}. No shopper turn was sent.`,
    );
  }
  if (campaign.status === 'failed') {
    throw new Error(
      `Campaign is stopped at ${campaign.firstFailure?.caseId}: ${campaign.firstFailure?.reason}`,
    );
  }
  if (campaign.status === 'complete')
    test.skip(true, 'All eight cases have passed and been independently reviewed.');
  const next = nextStage4Case(campaign);
  if (!next) throw new Error('Campaign has no eligible next case; inspect its persisted status.');
  verifyStage4Pins(campaign.pins, startPins.pins);
  const caseDir = caseOutputDirectory(runDir, next.id);
  if (fs.existsSync(caseDir))
    throw new Error(`Refusing to rerun case or overwrite receipts: ${caseDir}`);
  fs.mkdirSync(caseDir, { recursive: true });
  writeJson(path.join(caseDir, 'input.json'), { caseId: next.id, input: caseText[next.id] });
  campaign = beginStage4Case(campaign, next.id, startPins.pins);
  saveCampaign(runDir, campaign);
  appendStage4CampaignEvent(runDir, {
    type: 'case-started',
    caseId: next.id,
    completionCap: next.completionCap,
  });

  const receipts: NetworkReceipt[] = [];
  const byRequest = new WeakMap<Request, NetworkReceipt>();
  const responseReads: Promise<void>[] = [];
  const consoleErrors: string[] = [];
  const offAllowlist: string[] = [];
  const evidenceAttempts: Array<Record<string, unknown>> = [];
  let completionRequests = 0;
  let blockedCompletionAttempts = 0;
  let capExceeded = false;
  let unexpectedRetrieval = false;
  let stopRequested = false;
  const initialRuntimeFiles = startPins.runtimeFiles;

  page.on('request', (request) => {
    const kind = requestKind(request.url());
    if (!['chat', 'evidence', 'product'].includes(kind)) return;
    const receipt: NetworkReceipt = {
      sequence: receipts.length + 1,
      url: request.url(),
      method: request.method(),
      requestBody: request.postData() ?? null,
      status: null,
      responseBodyFile: null,
      responseError: null,
      networkFailure: null,
      at: new Date().toISOString(),
    };
    receipts.push(receipt);
    byRequest.set(request, receipt);
    const requestFile = `network-${String(receipt.sequence).padStart(3, '0')}.request.json`;
    writeJson(path.join(caseDir, requestFile), receipt);
    appendStage4CampaignEvent(runDir, {
      type: 'request-captured',
      caseId: next.id,
      sequence: receipt.sequence,
      kind,
      path: requestFile,
    });
    if (kind === 'evidence' || kind === 'product') {
      evidenceAttempts.push({
        kind,
        url: request.url(),
        requestBody: parseJson(receipt.requestBody),
      });
    }
  });
  page.on('response', (response) => {
    const receipt = byRequest.get(response.request());
    if (!receipt) return;
    receipt.status = response.status();
    responseReads.push(
      (async () => {
        const responseFile = `network-${String(receipt.sequence).padStart(3, '0')}.response.json`;
        try {
          const body = await response.text();
          const kind = requestKind(receipt.url);
          const bodyFile =
            kind === 'chat'
              ? `network-${String(receipt.sequence).padStart(3, '0')}.sse.txt`
              : responseFile;
          fs.writeFileSync(path.join(caseDir, bodyFile), body, { flag: 'wx' });
          receipt.responseBodyFile = bodyFile;
          if (kind !== 'chat') {
            writeJson(path.join(caseDir, responseFile), {
              status: receipt.status,
              body,
            });
          }
          writeJson(
            path.join(caseDir, `network-${String(receipt.sequence).padStart(3, '0')}.request.json`),
            receipt,
          );
          appendStage4CampaignEvent(runDir, {
            type: 'response-captured',
            caseId: next.id,
            sequence: receipt.sequence,
            status: receipt.status,
            path: bodyFile,
          });
        } catch (error) {
          receipt.responseError = error instanceof Error ? error.message : String(error);
          writeJson(
            path.join(caseDir, `network-${String(receipt.sequence).padStart(3, '0')}.request.json`),
            receipt,
          );
        }
      })(),
    );
  });
  page.on('requestfailed', (request) => {
    const receipt = byRequest.get(request);
    if (!receipt) return;
    receipt.networkFailure = request.failure()?.errorText ?? 'request failed without a reason';
    writeJson(
      path.join(caseDir, `network-${String(receipt.sequence).padStart(3, '0')}.request.json`),
      receipt,
    );
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 600));
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message.slice(0, 600)));

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const kind = requestKind(requestUrl.toString());
    const decision = decideStage4Request({
      hostAllowed: isLocalOrApprovedReadHost(requestUrl),
      kind,
      caseKind: next.kind,
      completionRequests,
      completionCap: next.completionCap,
      stopRequested,
    });
    if (decision.action === 'abort') {
      if (decision.reason === 'off_allowlist') offAllowlist.push(requestUrl.origin);
      if (decision.reason === 'completion_cap') {
        blockedCompletionAttempts += 1;
        capExceeded = true;
      }
      if (decision.reason === 'premature_retrieval') {
        unexpectedRetrieval = true;
        stopRequested = true;
      }
      if (decision.reason === 'stop_requested') blockedCompletionAttempts += 1;
      await route.abort('blockedbyclient');
      return;
    }
    if (kind === 'chat') completionRequests += 1;
    await route.continue();
  });

  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
  const assistantReplies = panel.locator('.connected-assistant-message');
  let visibleReplyCount = 0;
  let replyText = '';
  let cardIds: string[] = [];
  let cardTexts: string[] = [];
  let shoppingState: unknown = null;
  let sdkTranscript: unknown = null;
  let outcome = { passed: false, failures: ['case did not complete'] as string[] };
  let endPins: RuntimePins | null = null;

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    await expect(input).toBeVisible();
    await page.screenshot({ path: path.join(caseDir, 'before.png'), fullPage: false });
    const repliesBefore = await assistantReplies.count();
    await input.fill(caseText[next.id]);
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect
      .poll(
        async () =>
          ((await input.isEnabled()) && (await assistantReplies.count()) > repliesBefore) ||
          capExceeded ||
          unexpectedRetrieval,
        { timeout: 180_000 },
      )
      .toBe(true);
    if (capExceeded || unexpectedRetrieval) {
      const stop = panel.getByRole('button', { name: 'Stop', exact: true });
      if (await stop.count()) await stop.click();
    }
    visibleReplyCount = await assistantReplies.count();
    if (visibleReplyCount > repliesBefore) {
      replyText = ((await assistantReplies.last().textContent()) ?? '').trim();
    }
    const cards = page.locator('.pw-discover .pw-product');
    cardIds = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-product-id') ?? 'identity-unknown'),
    );
    cardTexts = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.trim() ?? ''),
    );
    shoppingState = await page.evaluate(() => {
      const raw = sessionStorage.getItem('jtv.shopping.v3');
      if (!raw) return null;
      const state = JSON.parse(raw);
      return {
        missionId: state.missionId,
        revision: state.brief?.revision,
        facts: state.brief?.facts,
        activeView: state.activeView,
        savedIds: (state.products ?? []).map(
          (item: { product?: { id?: string } }) => item.product?.id,
        ),
        compareIds: state.compareIds,
      };
    });
    sdkTranscript = await page.evaluate(() => {
      const raw = sessionStorage.getItem('instantsearch-chat-initial-messages');
      if (!raw) return { raw: null, assistants: [] };
      const messages = JSON.parse(raw);
      return {
        raw,
        assistants: Array.isArray(messages)
          ? messages
              .filter((message: { role?: string }) => message?.role === 'assistant')
              .map((message: { id?: string; parts?: Array<Record<string, unknown>> }) => ({
                id: message.id,
                parts: Array.isArray(message.parts)
                  ? message.parts.map((part) => ({
                      type: part.type,
                      state: part.state,
                      text: typeof part.text === 'string' ? part.text : undefined,
                      toolName:
                        typeof part.type === 'string' && part.type.startsWith('tool-')
                          ? part.type.slice(5)
                          : undefined,
                    }))
                  : [],
              }))
          : [],
      };
    });
    await page.screenshot({ path: path.join(caseDir, 'after.png'), fullPage: false });

    const failures: string[] = [];
    if (visibleReplyCount <= repliesBefore || !replyText)
      failures.push('no completed visible assistant reply');
    if (capExceeded || blockedCompletionAttempts)
      failures.push(`completion cap ${next.completionCap} was reached`);
    if (unexpectedRetrieval && next.kind === 'opening')
      failures.push('retrieval was attempted during an open-ended intake case');
    if (offAllowlist.length)
      failures.push(`blocked external origins: ${[...new Set(offAllowlist)].join(', ')}`);
    if (consoleErrors.length) failures.push(`browser errors captured: ${consoleErrors.length}`);
    if (next.kind === 'opening') {
      if (evidenceAttempts.length)
        failures.push('retrieval endpoint was called during an open-ended case');
      if (cardIds.length)
        failures.push(`open-ended case displayed ${cardIds.length} product cards`);
      const transcript = sdkTranscript as {
        assistants?: Array<{ parts?: Array<{ type?: string; toolName?: string }> }>;
      };
      const parts = (transcript.assistants ?? []).flatMap((message) => message.parts ?? []);
      const firstText = parts.findIndex((part) => part.type === 'text');
      const updates = parts
        .map((part, index) => ({ part, index }))
        .filter(({ part }) => part.type?.includes('update_shopping_state'));
      if (updates.length < 1 || firstText < 0 || updates[0].index > firstText) {
        failures.push('no shopping-state update was captured before assistant text');
      }
    } else if (next.id === 'named-category') {
      if (!evidenceAttempts.length) failures.push('named-category case did not retrieve evidence');
      if (cardIds.length !== 3 || new Set(cardIds).size !== 3) {
        failures.push(
          `named-category case displayed ${cardIds.length} distinct cards, expected three`,
        );
      }
    } else {
      if (!evidenceAttempts.length) failures.push('exact-item case did not retrieve evidence');
      if (cardIds.length !== 1 || cardIds[0] !== 'VG273B') {
        failures.push(
          `exact-item case displayed IDs ${JSON.stringify(cardIds)}, expected only VG273B`,
        );
      }
    }
    outcome = { passed: failures.length === 0, failures };
  } catch (error) {
    outcome = {
      passed: false,
      failures: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    await Promise.race([
      Promise.all(responseReads),
      new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
    try {
      endPins = readRuntimePins(repoRoot);
      verifyStage4Pins(startPins.pins, endPins.pins);
    } catch (error) {
      outcome = {
        passed: false,
        failures: [
          ...outcome.failures,
          `source pin changed or failed at end: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
    writeJson(path.join(runDir, `pins-${next.id}-end.json`), {
      pins: endPins?.pins ?? null,
      runtimeFiles: endPins?.runtimeFiles ?? initialRuntimeFiles,
      agentSnapshotPath: endPins ? path.relative(repoRoot, endPins.agentSnapshotPath) : null,
    });
    const receipt = {
      caseId: next.id,
      caseKind: next.kind,
      input: caseText[next.id],
      completionCap: next.completionCap,
      completionRequests,
      blockedCompletionAttempts,
      outcome,
      replyText,
      cardIds,
      cardTexts,
      shoppingState,
      sdkTranscript,
      evidenceAttempts,
      consoleErrors,
      offAllowlist,
      networkReceipts: receipts,
      sourcePinsStart: startPins.pins,
      sourcePinsEnd: endPins?.pins ?? null,
      capturedAt: new Date().toISOString(),
    };
    writeJson(path.join(caseDir, 'receipt.json'), receipt);
    appendStage4CampaignEvent(runDir, {
      type: 'case-completed',
      caseId: next.id,
      completionRequests,
      passed: outcome.passed,
      failures: outcome.failures,
    });
    campaign = completeStage4Case(campaign, next.id, {
      completionRequests,
      passed: outcome.passed,
      failures: outcome.failures,
      receiptPath: path.relative(runDir, path.join(caseDir, 'receipt.json')),
    });
    saveCampaign(runDir, campaign);
    if (campaign.cases.find((item) => item.id === next.id)?.status === 'awaiting_semantic_review') {
      const template = writeReviewTemplate(runDir, next.id);
      console.log(`Case awaits independent semantic review: ${path.relative(runDir, template)}`);
    }
  }
  expect(outcome.passed, outcome.failures.join('; ')).toBe(true);
});
