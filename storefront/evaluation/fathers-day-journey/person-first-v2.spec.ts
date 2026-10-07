import { expect, test, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Scenario inventory before test code:
// Six open-ended gift/milestone openings: canonical anniversary, Father and
// graduation inputs plus one meaning-preserving paraphrase of each.
// Four exception cases: exact item, direct education, explicit show-options,
// and a chosen category with genuine uncertainty.
// Failure modes: absent generated reply, notice, uncommitted turn, transport
// failure, request budget, source drift, missing agent snapshot and browser
// errors. Semantic tone/grounding remains UNKNOWN until independent review.
// No expected assistant sentence is sent to the agent or asserted.

const live = process.env.JTV_RUN_PERSON_FIRST_V2 === '1';
const budget = Number(process.env.JTV_MAX_COMPLETION_REQUESTS);
const snapshotEnv = process.env.JTV_AGENT_SNAPSHOT ?? '';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.join(
  repoRoot,
  '.checkpoint',
  'runs',
  `person-first-v2-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const runtimeFiles = [
  'storefront/src/concierge/ConnectedConcierge.tsx',
  'storefront/src/concierge/sdkTools.ts',
  'storefront/src/concierge/toolRuntime.ts',
  'storefront/src/concierge/ConciergeWorkspaceProvider.tsx',
  'storefront/server/api.ts',
  'storefront/server/concierge/retrieveEvidence.ts',
  'storefront/shared/concierge/state/updateShoppingState.ts',
] as const;

type Case = { id: string; kind: 'story' | 'exception'; prompt: string };
const cases: Case[] = [
  {
    id: 'anniversary',
    kind: 'story',
    prompt:
      "I want to buy a gift for my wife for our 10th anniversary, but I don't know where to start. She likes white gold and restrained designs. Nothing flashy, just a classy, timeless piece. My budget is $500. Help me.",
  },
  {
    id: 'father',
    kind: 'story',
    prompt:
      "Father's Day is coming up. Dad always says not to get him anything, but he's always been there for me. He loves watches, and I want to get him one he'd actually wear. I have no idea where to begin.",
  },
  {
    id: 'graduation',
    kind: 'story',
    prompt:
      "My daughter is graduating next month. I'm so proud of her. I'd love to get her jewellery she'll still want to wear a year from now, not something that just says graduation.",
  },
  {
    id: 'anniversary-variant',
    kind: 'story',
    prompt:
      "We've been married ten years next month. My wife likes simple white-gold pieces, and I can spend about $500, but I'm stuck on what would feel like her.",
  },
  {
    id: 'father-variant',
    kind: 'story',
    prompt:
      "Dad never asks for gifts, but he's always shown up for me. I'd love to thank him with a watch this Father's Day, and I'm not sure where to begin.",
  },
  {
    id: 'graduation-variant',
    kind: 'story',
    prompt:
      "My daughter worked hard for her degree. I want to celebrate with a piece of jewellery she'll keep wearing, but I don't yet know what she'd choose.",
  },
  { id: 'exact-item', kind: 'exception', prompt: 'Show me JTV watch 1W9E1B and tell me what its listing actually says.' },
  { id: 'education', kind: 'exception', prompt: 'What does JTV explain about natural versus lab-created sapphire?' },
  { id: 'show-options', kind: 'exception', prompt: 'Show me two wrist watches under $200 to compare.' },
  {
    id: 'chosen-category-unsure',
    kind: 'exception',
    prompt: "I know I want a watch for my father, but I don't know which style would feel like him.",
  },
];
const requestedCaseIds = (process.env.JTV_PERSON_FIRST_CASE_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const selectedCases = requestedCaseIds.length ? cases.filter((item) => requestedCaseIds.includes(item.id)) : cases;
const caseSelectionReady = selectedCases.length > 0 && selectedCases.length === (requestedCaseIds.length || cases.length);
const budgetReady = Number.isSafeInteger(budget) && budget === (selectedCases.length === 1 ? 8 : 40);

type Capture = {
  caseId: string;
  url: string;
  method: string;
  requestBody: string | null;
  status: number | null;
  networkFailure: string | null;
  captureError: string | null;
  responseFile: string | null;
};

function hashSources() {
  return Object.fromEntries(
    runtimeFiles.map((file) => [file, createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex')]),
  );
}

function git(args: string[]) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}

function completedCount(page: Page) {
  return page.evaluate(() => {
    let count = 0;
    for (const [key, value] of Object.entries(sessionStorage)) {
      if (!key.startsWith('jtv-concierge-completed-')) continue;
      try {
        const parsed = JSON.parse(value) as { assistantMessageIds?: unknown };
        if (Array.isArray(parsed.assistantMessageIds)) count += parsed.assistantMessageIds.length;
      } catch {
        // A malformed receipt is not a completed response.
      }
    }
    return count;
  });
}

test('person-first method across three stories and four exceptions', async ({ browser }) => {
  test.skip(!live, 'Connected after-test is opt-in.');
  test.skip(!caseSelectionReady, 'Selected case IDs must match known opening/exception cases exactly.');
  test.skip(!budgetReady, `Set JTV_MAX_COMPLETION_REQUESTS=${selectedCases.length === 1 ? 8 : 40} for this finite window.`);
  test.skip(!snapshotEnv, 'Set JTV_AGENT_SNAPSHOT to the exact saved readback path.');

  const snapshotPath = path.resolve(snapshotEnv);
  const allowed = path.join(repoRoot, 'storefront', 'evidence') + path.sep;
  if (!snapshotPath.startsWith(allowed)) throw new Error('Agent snapshot must be under storefront/evidence.');
  const agentSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
    agentId?: string;
    hashes?: Record<string, string>;
  };
  fs.mkdirSync(outDir, { recursive: true });
  const sourceBefore = hashSources();
  const captures: Capture[] = [];
  const results: Array<Record<string, unknown>> = [];
  let requestCount = 0;
  let firstMechanicalFailure: string | null = null;
  let capReached = false;

  try {
    for (const item of selectedCases) {
      if (firstMechanicalFailure || capReached) break;
      const context = await browser.newContext();
      const page = await context.newPage();
      const pending: Promise<void>[] = [];
      const caseCaptureStart = captures.length;
      const beforeRequests = requestCount;
      const started = Date.now();
      const result: Record<string, unknown> = {
        id: item.id,
        kind: item.kind,
        shopper: item.prompt,
        reply: '',
        notices: [],
        cardIds: [],
        sourceReview: 'unknown',
        semanticReview: 'unknown',
      };
      results.push(result);

      await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        if (requestCount > budget) {
          capReached = true;
          await route.abort();
        } else await route.continue();
      });
      page.on('request', (request: Request) => {
        if (!['/api/chat', '/api/agent-evidence', '/api/agent-product-refresh', '/api/products/'].some((part) => request.url().includes(part)))
          return;
        const index = captures.length;
        const capture: Capture = {
          caseId: item.id,
          url: request.url(),
          method: request.method(),
          requestBody: request.postData(),
          status: null,
          networkFailure: null,
          captureError: null,
          responseFile: null,
        };
        captures.push(capture);
        pending.push(
          (async () => {
            try {
              const response = await request.response();
              capture.status = response?.status() ?? null;
              if (!response) return;
              const endpoint = request.url().includes('/api/chat')
                ? 'chat'
                : request.url().includes('/api/agent-evidence')
                  ? 'evidence'
                  : request.url().includes('/api/agent-product-refresh')
                    ? 'refresh'
                    : 'product';
              const file = `${item.id}-${index}-${endpoint}.txt`;
              fs.writeFileSync(path.join(outDir, file), await response.body());
              capture.responseFile = file;
            } catch (error) {
              capture.captureError = String(error);
              capture.networkFailure = request.failure()?.errorText ?? null;
            }
          })(),
        );
      });

      try {
        const health = await page.request.get('/api/health');
        result.health = await health.json();
        await page.goto('/');
        await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
        const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
        const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
        await expect(input).toBeVisible();
        const receiptsBefore = await completedCount(page);
        const repliesBefore = await panel.locator('.connected-assistant-message').count();
        await input.fill(item.prompt);
        await panel.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(input).toBeDisabled({ timeout: 10_000 });
        await expect(input).toBeEnabled({ timeout: 180_000 });
        const repliesAfter = await panel.locator('.connected-assistant-message').count();
        if (repliesAfter > repliesBefore)
          result.reply = (await panel.locator('.connected-assistant-message').last().innerText()).trim();
        result.notices = await panel.locator('.connected-system-notice').allTextContents();
        result.cardIds = await panel.locator('.pw-discover .pw-product').evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-product-id') ?? ''),
        );
        result.completedReceipt = (await completedCount(page)) > receiptsBefore;
        result.session = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
        await panel.screenshot({ path: path.join(outDir, `${item.id}-panel.png`) });
        await page.screenshot({ path: path.join(outDir, `${item.id}-viewport.png`), fullPage: false });
      } catch (error) {
        result.error = String(error);
      } finally {
        await Promise.allSettled(pending);
        result.completionRequests = requestCount - beforeRequests;
        result.apiCaptures = captures.slice(caseCaptureStart);
        result.elapsedMs = Date.now() - started;
        if (!result.reply || !result.completedReceipt || (result.notices as unknown[]).length || result.error) {
          firstMechanicalFailure = item.id;
        }
        fs.writeFileSync(path.join(outDir, `${item.id}.json`), JSON.stringify(result, null, 2));
        await context.close();
      }
    }
  } finally {
    const sourceAfter = hashSources();
    const sourceDrift = runtimeFiles.filter((file) => sourceBefore[file] !== sourceAfter[file]);
    const report = {
      at: new Date().toISOString(),
      mode: 'connected-after-test-not-acceptance',
      app: { head: git(['rev-parse', 'HEAD']), originMain: git(['rev-parse', 'origin/main']), status: git(['status', '--short']) },
      agentSnapshot: { path: snapshotPath, agentId: agentSnapshot.agentId, hashes: agentSnapshot.hashes },
      sourceBefore,
      sourceAfter,
      sourceDrift,
      requestBudget: budget,
      completionRequests: requestCount,
      capReached,
      firstMechanicalFailure,
      completedCases: results.length,
      notRun: selectedCases.slice(results.length).map((item) => item.id),
      results,
      captures,
    };
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(report, null, 2));
  }
  expect(firstMechanicalFailure, `First failure and receipts at ${outDir}`).toBeNull();
  expect(capReached, `Request cap reached; receipts at ${outDir}`).toBe(false);
  expect(results, `Every selected case must execute; receipts at ${outDir}`).toHaveLength(selectedCases.length);
  expect(false, `Semantic and source review is still required; receipts at ${outDir}`).toBe(true);
});
