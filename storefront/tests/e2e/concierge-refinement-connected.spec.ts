import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { V3_SESSION_KEY } from '../../src/concierge/sessionPersistence.js';

const liveEnabled = process.env.JTV_RUN_STAGE5_CONNECTED === '1';
const requestedBudget = Number(process.env.JTV_STAGE5_MAX_COMPLETIONS);
const budgetReady = Number.isSafeInteger(requestedBudget) && requestedBudget > 0;
const interceptedPaths = ['/api/chat', '/api/agent-evidence', '/api/agent-product-refresh'];

type CapturedRequest = {
  turn: string;
  path: string;
  method: string;
  body: unknown;
  status: number | null;
  response: unknown;
  responseError?: string;
  failed: boolean;
};

function safeBody(request: Request): unknown {
  try {
    return request.postDataJSON();
  } catch {
    return request.postData() ?? null;
  }
}

async function openConcierge(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toBeVisible();
  return panel;
}

test('connected refinements update Discover while preserving Saved and Compare', async ({
  browser,
}, testInfo) => {
  test.skip(!liveEnabled, 'Paid connected Stage 5 check is opt-in.');
  test.skip(!budgetReady, 'Set JTV_STAGE5_MAX_COMPLETIONS as an explicit stop budget.');

  const runDir = path.resolve(
    process.cwd(),
    '..',
    '.checkpoint',
    'runs',
    `stage5-refinement-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  fs.mkdirSync(runDir, { recursive: true });
  const uiActions: Array<Record<string, unknown>> = [];
  const evidence: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    maximumCompletionRequests: requestedBudget,
    turns: [],
    uiActions,
    requests: [],
    firstFailure: null,
  };
  const requests: CapturedRequest[] = [];
  const pendingCaptures: Promise<void>[] = [];
  const requestRecords = new WeakMap<Request, CapturedRequest>();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let activeTurn: string | null = null;
  let completionRequests = 0;
  let admittedCompletionRequests = 0;
  let budgetExceeded = false;

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!interceptedPaths.includes(url.pathname)) return;
    if (url.pathname === '/api/chat') completionRequests += 1;
    const record: CapturedRequest = {
      turn: activeTurn ?? 'outside-turn',
      path: url.pathname,
      method: request.method(),
      body: safeBody(request),
      status: null,
      response: null,
      failed: false,
    };
    requestRecords.set(request, record);
    requests.push(record);
    pendingCaptures.push(
      (async () => {
        try {
          const response = await request.response();
          if (!response) {
            record.failed = true;
            return;
          }
          record.status = response.status();
          if (url.pathname === '/api/chat') {
            record.response = { stream: true, headers: response.headers() };
          } else {
            const body = await response.text();
            try {
              record.response = JSON.parse(body);
            } catch {
              record.responseError = 'Response body was not valid JSON.';
            }
          }
        } catch (error) {
          record.failed = true;
          record.responseError = error instanceof Error ? error.message : String(error);
        }
      })(),
    );
  });
  page.on('requestfailed', (request) => {
    const record = requestRecords.get(request);
    if (record) {
      record.failed = true;
      record.responseError = request.failure()?.errorText ?? 'Request failed.';
    }
  });
  page.on('response', (response) => {
    const record = requestRecords.get(response.request());
    if (record) record.status = response.status();
  });
  await page.route('**/api/chat', async (route) => {
    if (admittedCompletionRequests >= requestedBudget) {
      budgetExceeded = true;
      await route.abort('aborted');
      return;
    }
    admittedCompletionRequests += 1;
    await route.continue();
  });

  const turnSnapshots: Array<Record<string, unknown>> = [];
  let firstFailure: string | null = null;

  async function runTurn(turnId: string, shopperText: string) {
    const requestStart = requests.length;
    const captureStart = pendingCaptures.length;
    activeTurn = turnId;
    const input = page
      .getByRole('complementary', { name: 'Jewelry buying Concierge' })
      .getByRole('textbox', { name: 'Message the Concierge' });
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    const replyCountBefore = await panel.locator('.connected-assistant-message').count();
    const noticeCountBefore = await panel.locator('.connected-system-notice').count();
    await input.fill(shopperText);
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(input).toBeDisabled();
    await expect(input).toBeEnabled({ timeout: 120_000 });
    activeTurn = null;
    await Promise.all(pendingCaptures.slice(captureStart));
    if (budgetExceeded) throw new Error('Completion request budget was exceeded.');
    const captured = requests.slice(requestStart);
    const chats = captured.filter((request) => request.path === '/api/chat');
    if (!chats.length) throw new Error(`${turnId}: no /api/chat request was captured.`);
    if (chats.some((request) => request.status === null || request.status >= 400))
      throw new Error(`${turnId}: a connected chat request failed.`);

    const workspace = panel.getByRole('region', { name: 'Shopping choices' });
    const visible = await workspace.evaluate((node) => ({
      view: node.querySelector('.pw-views button[aria-current="page"]')?.textContent?.trim() ?? '',
      groups: [...node.querySelectorAll('.pw-discovery-group')].map((group) => ({
        title: group.querySelector('h3')?.textContent?.trim() ?? '',
        productIds: [...group.querySelectorAll('.pw-product[data-product-id]')].map((product) =>
          product.getAttribute('data-product-id'),
        ),
      })),
      productIds: [...node.querySelectorAll('.pw-discover .pw-product[data-product-id]')].map(
        (product) => product.getAttribute('data-product-id'),
      ),
    }));
    const session = await page.evaluate((key) => {
      const value = sessionStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, V3_SESSION_KEY);
    const replies = await panel.locator('.connected-assistant-message').allTextContents();
    const notices = await panel.locator('.connected-system-notice').allTextContents();
    const newNoticeCount = await panel.locator('.connected-system-notice').count();
    const snapshot = {
      turnId,
      shopperText,
      capturedRequests: captured,
      brief: {
        missionId: session?.missionId ?? null,
        revision: session?.brief?.revision ?? null,
        activeFacts: (session?.brief?.facts ?? []).filter(
          (fact: { status?: string }) => fact.status === 'active',
        ),
      },
      returnedEvidenceIds: captured
        .filter((request) => request.path === '/api/agent-evidence')
        .flatMap((request) => {
          const response = request.response as { records?: Array<Record<string, unknown>> } | null;
          return (response?.records ?? []).map((record) => ({
            source: record.source,
            objectID: record.objectID,
            contentHash: record.contentHash,
            evidenceRef: record.evidenceRef,
          }));
        }),
      visible,
      savedIds: (session?.products ?? []).map((product: { objectID: string }) => product.objectID),
      compareIds: session?.compareIds ?? [],
      assistantReply: replies.at(-1) ?? '',
      newAssistantReplies: replies.length - replyCountBefore,
      newNotices: newNoticeCount - noticeCountBefore,
      notices,
      streamAbortedAfterHttpOk: chats.some((request) => request.status === 200 && request.failed),
      clientTraceText: await page
        .locator('[data-testid="demo-diagnostics"]')
        .textContent()
        .catch(() => null),
    };
    turnSnapshots.push(snapshot);
    if (
      captured.some(
        (request) =>
          request.path !== '/api/chat' && (request.status === null || (request.status ?? 0) >= 400),
      )
    )
      throw new Error(`${turnId}: a connected evidence request failed.`);
    if (snapshot.newAssistantReplies < 1 || snapshot.newNotices > 0)
      throw new Error(`${turnId}: no complete generated reply was visible after the request.`);
    return snapshot;
  }

  try {
    const panel = await openConcierge(page);
    const first = await runTurn(
      'refinement-1',
      'Show me two 14k white-gold chain necklaces under $500. No hearts.',
    );
    const firstIds = (first.visible as { productIds: string[] }).productIds;
    if (first.newNotices) throw new Error('refinement-1 produced a system notice.');
    if (firstIds.length < 2)
      throw new Error(`refinement-1 displayed only ${firstIds.length} product cards.`);
    if (
      (first.returnedEvidenceIds as Array<{ source?: string }>).some(
        (record) => record.source !== 'prod_catalog',
      )
    )
      throw new Error('A product-only turn returned evidence from another source.');

    const workspace = panel.getByRole('region', { name: 'Shopping choices' });
    const savedIds = firstIds.slice(0, 2);
    for (const id of savedIds) {
      const card = workspace.locator(`.pw-discover .pw-product[data-product-id="${id}"]`).first();
      await card.getByRole('button', { name: 'Save', exact: true }).click();
      await card.getByRole('button', { name: 'Compare', exact: true }).click();
    }
    await workspace
      .getByRole('navigation', { name: 'Product views' })
      .getByRole('button', { name: /^Compare/ })
      .click();
    await expect(workspace.locator('.pw-compare-product[data-product-id]')).toHaveCount(2);
    await expect(workspace.locator('.pw-compare-product[data-product-id]')).toHaveCount(2);
    await page
      .getByRole('complementary', { name: 'Jewelry buying Concierge' })
      .locator(`.pw-compare-product[data-product-id="${savedIds[1]}"]`)
      .getByRole('button', { name: 'Remove from comparison' })
      .click();
    await expect(workspace.locator('.pw-compare-product[data-product-id]')).toHaveCount(1);
    const beforeRefinement = await page.evaluate((key) => {
      const value = sessionStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, V3_SESSION_KEY);
    const savedBeforeRefinement = beforeRefinement?.products?.map(
      (product: { objectID: string }) => product.objectID,
    );
    const compareBeforeRefinement = beforeRefinement?.compareIds ?? [];

    uiActions.push({
      action: 'save-two-compare-two-downselect-to-one',
      savedIds: savedBeforeRefinement,
      compareIds: compareBeforeRefinement,
    });
    if (JSON.stringify(savedBeforeRefinement) !== JSON.stringify(savedIds))
      throw new Error('Saved items changed during Compare downselection.');
    if (JSON.stringify(compareBeforeRefinement) !== JSON.stringify([savedIds[0]]))
      throw new Error('Compare downselection did not retain exactly the first saved item.');

    const second = await runTurn(
      'refinement-2',
      'Now show me simple white-gold stud earrings under $500, with no hearts. Keep my saved necklace choices and the first necklace in Compare.',
    );
    const secondIds = (second.visible as { productIds: string[] }).productIds;
    if (second.newNotices) throw new Error('refinement-2 produced a system notice.');
    if (!secondIds.length) throw new Error('refinement-2 did not update Discover with products.');
    if (secondIds.every((id) => firstIds.includes(id)))
      throw new Error('refinement-2 did not change the visible product choices.');
    if (JSON.stringify(second.savedIds) !== JSON.stringify(savedIds))
      throw new Error('Saved items changed during the new product search.');
    if (JSON.stringify(second.compareIds) !== JSON.stringify([savedIds[0]]))
      throw new Error('The narrowed comparison changed during the new product search.');
    if (second.visible.view.toLowerCase().startsWith('compare'))
      throw new Error('Discover was not selected after the new product presentation.');
    if (
      (second.returnedEvidenceIds as Array<{ source?: string }>).some(
        (record) => record.source !== 'prod_catalog',
      )
    )
      throw new Error('A product-only refinement returned evidence from another source.');
  } catch (error) {
    firstFailure = error instanceof Error ? error.message : String(error);
    evidence.firstFailure = firstFailure;
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    evidence.completionRequestCount = completionRequests;
    evidence.requests = requests;
    evidence.turns = turnSnapshots;
    const evidencePath = path.join(runDir, 'stage5-refinement-evidence.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    await testInfo.attach('stage5-refinement-evidence.json', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: 'application/json',
    });
    await context.close().catch(() => undefined);
  }
});
