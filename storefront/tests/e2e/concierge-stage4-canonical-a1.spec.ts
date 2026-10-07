/*
 * Stage 4 canonical A1 opening. Paid only with JTV_RUN_STAGE4_A1=1.
 *
 * Scenarios:
 * - Canonical tenth-anniversary intake produces a visible assistant reply.
 * - Before the shopper answers what his wife wears, no Concierge retrieval or
 *   Discover card is shown for this story.
 * - Retrieval attempt is recorded and aborted locally after the first call so
 *   an A1 failure does not fan out into more searches.
 * - Missing reply, browser error, unsupported source, and completion-cap stop
 *   are retained as failures, never passes.
 *
 * This test does not match assistant prose to a scripted sentence. The reply
 * and all tool/network receipts are saved for semantic review.
 */
import { expect, test, type Request } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const live = process.env.JTV_RUN_STAGE4_A1 === '1';
const requestCap = Number(process.env.JTV_MAX_COMPLETION_REQUESTS ?? 16);
const runDir =
  process.env.JTV_STAGE4_RUN_DIR ??
  path.resolve(
    process.cwd(),
    '..',
    '.checkpoint',
    'runs',
    `stage4-canonical-a1-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
const shopperText =
  "I want to buy a gift for my wife for our 10th anniversary, but I don't know where to start. She likes white gold and restrained designs. Nothing flashy, just a classy, timeless piece. My budget is $500. Help me.";

type RecordItem = {
  url: string;
  requestBody: string | null;
  status: number | null;
  responseBody: string | null;
  bodyCaptureError: string | null;
  networkFailure: string | null;
  requestId: string | null;
  cdpResponseBody: string | null;
  cdpBodyError: string | null;
  cdpLoadingFinished: boolean;
  sseDone: boolean;
  at: string;
};

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function walkSource(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkSource(absolute)));
    else if (/\.(ts|tsx|js|mjs|css|json)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

async function runtimePin(repoRoot: string, agentSnapshotPath: string) {
  const storefrontRoot = path.join(repoRoot, 'storefront');
  const files = [
    ...(await walkSource(path.join(storefrontRoot, 'src'))),
    ...(await walkSource(path.join(storefrontRoot, 'shared'))),
    ...(await walkSource(path.join(storefrontRoot, 'server'))),
    ...[
      'vite.config.ts',
      'package.json',
      'package-lock.json',
      'tests/e2e/concierge-stage4-canonical-a1.spec.ts',
      'tests/e2e/concierge-stage4-canonical.config.ts',
    ].map((relative) => path.join(storefrontRoot, relative)),
  ].sort();
  const runtimeHashes: Record<string, string> = {};
  for (const file of files) {
    runtimeHashes[path.relative(repoRoot, file)] = createHash('sha256')
      .update(await fs.promises.readFile(file))
      .digest('hex');
  }
  const snapshotRaw = await fs.promises.readFile(agentSnapshotPath);
  const snapshot = JSON.parse(snapshotRaw.toString()) as {
    agentId?: string;
    hashes?: Record<string, string>;
    configuration?: { agentId?: string; name?: string; model?: string; status?: string };
  };
  const evidenceDirectory = path.join(storefrontRoot, 'evidence');
  const latestSnapshot = (await fs.promises.readdir(evidenceDirectory))
    .filter((name) => /^agent-\d{4}-\d{2}-\d{2}T.*\.json$/.test(name))
    .sort()
    .at(-1);
  if (latestSnapshot !== path.basename(agentSnapshotPath)) {
    throw new Error(
      `Pinned agent snapshot is not the latest saved readback: ${latestSnapshot ?? 'none'}`,
    );
  }
  const developmentAgentId = (() => {
    const raw = fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf8');
    const match = raw.match(/^\s*JTV_CONCIERGE_DEVELOPMENT_AGENT_ID\s*=\s*(.*?)\s*$/m);
    return match?.[1]?.replace(/^(['"])(.*)\1$/, '$2') ?? null;
  })();
  const snapshotAgentId = snapshot.configuration?.agentId ?? snapshot.agentId ?? null;
  if (!developmentAgentId || developmentAgentId !== snapshotAgentId) {
    throw new Error('Root .env.local development agent ID does not match the pinned snapshot.');
  }
  return {
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim(),
    gitStatus: execFileSync(
      'git',
      [
        'status',
        '--porcelain',
        '--',
        'storefront/src',
        'storefront/shared',
        'storefront/server',
        'storefront/vite.config.ts',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    ),
    runtimeHashes,
    agentSnapshot: {
      path: path.relative(repoRoot, agentSnapshotPath),
      sha256: createHash('sha256').update(snapshotRaw).digest('hex'),
      agentId: snapshot.configuration?.agentId ?? snapshot.agentId ?? null,
      developmentEnvAgentId: developmentAgentId,
      name: snapshot.configuration?.name ?? null,
      model: snapshot.configuration?.model ?? null,
      status: snapshot.configuration?.status ?? null,
      instructionsHash: snapshot.hashes?.instructions ?? null,
      toolsHash: snapshot.hashes?.tools ?? null,
      configHash: snapshot.hashes?.config ?? null,
    },
  };
}

test('A1 diagnostic slice, not Stage 4 acceptance', async ({ page, context }) => {
  test.skip(!live, 'Paid test is opt-in (JTV_RUN_STAGE4_A1=1).');
  test.skip(!Number.isSafeInteger(requestCap) || requestCap < 1, 'Set a positive completion cap.');
  test.setTimeout(8 * 60_000);
  fs.mkdirSync(runDir, { recursive: true });
  const repoRoot = path.resolve(process.cwd(), '..');
  const agentSnapshotPath = process.env.JTV_STAGE4_AGENT_SNAPSHOT;
  if (!agentSnapshotPath) throw new Error('Set JTV_STAGE4_AGENT_SNAPSHOT before a paid run.');
  const runtimeStart = await runtimePin(repoRoot, agentSnapshotPath);
  await fs.promises.writeFile(
    path.join(runDir, 'runtime-pin-start.json'),
    JSON.stringify(runtimeStart, null, 2),
  );

  const records: RecordItem[] = [];
  const byRequest = new WeakMap<Request, RecordItem>();
  const cdpRequests = new Map<string, RecordItem>();
  const pendingCdpByUrl = new Map<string, RecordItem[]>();
  const responseBodyReads: Promise<void>[] = [];
  const cdpBodyReads: Promise<void>[] = [];
  const consoleErrors: string[] = [];
  const evidenceAttempts: Array<Record<string, unknown>> = [];
  let completionRequests = 0;
  let unexpectedEvidence: Record<string, unknown> | null = null;
  let capReached = false;
  let stopAfterEvidence = false;
  let blockedCompletionsAfterEvidence = 0;

  await page.route('**/api/chat', async (route) => {
    completionRequests += 1;
    if (completionRequests > requestCap) {
      capReached = true;
      await route.abort('blockedbyclient');
      return;
    }
    if (stopAfterEvidence) {
      blockedCompletionsAfterEvidence += 1;
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  await page.route('**/api/agent-evidence', async (route) => {
    stopAfterEvidence = true;
    unexpectedEvidence = {
      at: new Date().toISOString(),
      requestBody: parseJson(route.request().postData()),
    };
    evidenceAttempts.push({ ...unexpectedEvidence });
    await route.abort('blockedbyclient');
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (!/\/api\/(chat|agent-evidence)/.test(request.url)) return;
    const record: RecordItem = {
      url: request.url,
      requestBody: request.postData ?? null,
      status: null,
      responseBody: null,
      bodyCaptureError: null,
      networkFailure: null,
      requestId,
      cdpResponseBody: null,
      cdpBodyError: null,
      cdpLoadingFinished: false,
      sseDone: false,
      at: new Date().toISOString(),
    };
    cdpRequests.set(requestId, record);
    records.push(record);
    const queue = pendingCdpByUrl.get(request.url) ?? [];
    queue.push(record);
    pendingCdpByUrl.set(request.url, queue);
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    const record = cdpRequests.get(requestId);
    if (record) record.status = response.status;
  });
  cdp.on('Network.loadingFinished', ({ requestId }) => {
    const record = cdpRequests.get(requestId);
    if (!record) return;
    record.cdpLoadingFinished = true;
    cdpBodyReads.push(
      (async () => {
        try {
          const response = await cdp.send('Network.getResponseBody', { requestId });
          record.cdpResponseBody = response.base64Encoded
            ? Buffer.from(response.body, 'base64').toString('utf8')
            : response.body;
          record.sseDone = record.cdpResponseBody.includes('data: [DONE]');
        } catch (error) {
          record.cdpBodyError = error instanceof Error ? error.message : String(error);
        }
      })(),
    );
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
    const record = cdpRequests.get(requestId);
    if (record) record.networkFailure = errorText;
  });

  page.on('request', (request) => {
    if (!/\/api\/(chat|agent-evidence)/.test(request.url())) return;
    const record = pendingCdpByUrl.get(request.url())?.shift() ?? {
      url: request.url(),
      requestBody: request.postData(),
      status: null,
      responseBody: null,
      bodyCaptureError: null,
      networkFailure: null,
      requestId: null,
      cdpResponseBody: null,
      cdpBodyError: null,
      cdpLoadingFinished: false,
      sseDone: false,
      at: new Date().toISOString(),
    };
    record.requestBody = request.postData();
    if (!record.requestId) records.push(record);
    byRequest.set(request, record);
  });
  page.on('response', (response) => {
    const record = byRequest.get(response.request());
    if (!record) return;
    record.status = response.status();
    responseBodyReads.push(
      (async () => {
        try {
          record.responseBody = await response.text();
          record.sseDone ||= record.responseBody.includes('data: [DONE]');
        } catch (error) {
          record.bodyCaptureError = error instanceof Error ? error.message : String(error);
        }
      })(),
    );
  });
  page.on('requestfailed', (request) => {
    const record = byRequest.get(request);
    if (!record) return;
    record.networkFailure = request.failure()?.errorText ?? 'request failed without a reason';
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 600));
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message.slice(0, 600)));

  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
  const reply = panel.locator('.connected-assistant-message');
  let outcome: { status: string; detail: string } = { status: 'unknown', detail: '' };
  let replyText = '';
  let cardIds: string[] = [];
  let state: unknown = null;
  let sdkTranscript: unknown = null;

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    await expect(input).toBeVisible();
    await page.screenshot({ path: path.join(runDir, '00-open.png'), fullPage: false });

    const repliesBefore = await reply.count();
    await input.fill(shopperText);
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    try {
      await expect
        .poll(async () => (await input.isEnabled()) || unexpectedEvidence !== null || capReached, {
          timeout: 180_000,
        })
        .toBe(true);
    } catch {
      outcome = { status: 'fail', detail: 'Composer did not become ready within 180 seconds.' };
    }
    if (unexpectedEvidence || capReached) {
      const stop = panel.getByRole('button', { name: 'Stop', exact: true });
      if (await stop.count()) await stop.click();
    }
    if (!unexpectedEvidence && !capReached) {
      try {
        await expect.poll(() => reply.count(), { timeout: 5_000 }).toBeGreaterThan(repliesBefore);
      } catch {
        outcome = {
          status: 'fail',
          detail: 'No assistant reply rendered after the turn completed.',
        };
      }
    }
    const replyCount = await reply.count();
    if (replyCount > repliesBefore) replyText = ((await reply.last().textContent()) ?? '').trim();
    cardIds = await page
      .locator('.pw-discover .pw-product')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-product-id') ?? 'identity-unknown'),
      );
    state = await page.evaluate(() => {
      const value = sessionStorage.getItem('jtv.shopping.v3');
      if (!value) return null;
      const parsed = JSON.parse(value);
      return {
        missionId: parsed.missionId,
        revision: parsed.brief?.revision,
        facts: parsed.brief?.facts,
        activeView: parsed.activeView,
        savedIds: (parsed.products ?? []).map((item: any) => item.product?.id),
        compareIds: parsed.compareIds,
        combinationIds: parsed.combinationIds,
      };
    });
    sdkTranscript = await page.evaluate(() => {
      const raw = sessionStorage.getItem('instantsearch-chat-initial-messages');
      if (!raw) return { raw: null, assistants: [] };
      try {
        const messages = JSON.parse(raw);
        return {
          raw,
          assistants: Array.isArray(messages)
            ? messages
                .filter((message: any) => message?.role === 'assistant')
                .map((message: any) => ({
                  id: message.id,
                  parts: Array.isArray(message.parts)
                    ? message.parts.map((part: any) => ({
                        type: part.type,
                        state: part.state,
                        text: typeof part.text === 'string' ? part.text : undefined,
                        toolCallId: part.toolCallId,
                        toolName: part.type?.startsWith?.('tool-') ? part.type.slice(5) : undefined,
                      }))
                    : [],
                }))
            : [],
        };
      } catch (error) {
        return { raw, parseError: error instanceof Error ? error.message : String(error) };
      }
    });
    await page.screenshot({ path: path.join(runDir, 'A1-after.png'), fullPage: false });

    if (capReached) {
      outcome = { status: 'fail', detail: `Harness completion cap ${requestCap} reached.` };
    } else if (unexpectedEvidence) {
      outcome = {
        status: 'fail',
        detail:
          'The Concierge attempted catalogue/blog retrieval before the shopper answered the opening question.',
      };
    } else if (cardIds.length) {
      outcome = {
        status: 'fail',
        detail: `A1 displayed ${cardIds.length} product cards before the wear question was answered.`,
      };
    } else if (replyCount <= repliesBefore) {
      outcome = { status: 'fail', detail: 'The assistant did not render a new reply.' };
    } else if (consoleErrors.length) {
      outcome = {
        status: 'fail',
        detail: `Browser console errors were captured: ${consoleErrors.length}`,
      };
    } else {
      outcome = {
        status: 'partial',
        detail:
          'Mechanical A1 checks passed. Independent review must confirm the reply acknowledges the milestone and asks one useful question about everyday jewelry.',
      };
    }
  } catch (error) {
    outcome = { status: 'fail', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    let captureTimeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all([...responseBodyReads, ...cdpBodyReads]),
      new Promise<void>((resolve) => {
        captureTimeout = setTimeout(resolve, 10_000);
      }),
    ]);
    if (captureTimeout) clearTimeout(captureTimeout);
    let runtimeEnd: Awaited<ReturnType<typeof runtimePin>> | null = null;
    try {
      runtimeEnd = await runtimePin(repoRoot, agentSnapshotPath);
      await fs.promises.writeFile(
        path.join(runDir, 'runtime-pin-end.json'),
        JSON.stringify(runtimeEnd, null, 2),
      );
      if (
        JSON.stringify(runtimeStart) !== JSON.stringify(runtimeEnd) &&
        outcome.status !== 'fail'
      ) {
        outcome = {
          status: 'fail',
          detail: 'Runtime or Agent Studio snapshot changed during the A1 window.',
        };
      }
    } catch (error) {
      outcome = {
        status: 'fail',
        detail: `Could not verify frozen runtime/agent snapshot: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const summary = {
      capturedAt: new Date().toISOString(),
      runtimeStart,
      runtimeEnd,
      baseURL: process.env.JTV_E2E_BASE_URL ?? 'http://localhost:5173',
      completionRequests,
      requestCap,
      input: shopperText,
      outcome,
      replyText,
      cardIds,
      state,
      sdkTranscript,
      unexpectedEvidence,
      evidenceAttempts,
      blockedCompletionsAfterEvidence,
      consoleErrors,
      requests: records,
      rawSseFiles: [] as string[],
      note: 'This is a bounded A1 slice. It cannot pass Stage 4; continue to later beats only after A1 semantic review and a passing mechanical result.',
    };
    const chatRecords = records.filter((record) => record.url.includes('/api/chat'));
    for (let index = 0; index < chatRecords.length; index += 1) {
      const record = chatRecords[index];
      const rawSse = record.cdpResponseBody ?? record.responseBody;
      if (rawSse === null) continue;
      const fileName = `chat-${String(index + 1).padStart(2, '0')}.sse.txt`;
      await fs.promises.writeFile(path.join(runDir, fileName), rawSse);
      summary.rawSseFiles.push(fileName);
    }
    await fs.promises.writeFile(
      path.join(runDir, 'summary.json'),
      JSON.stringify(summary, null, 2),
    );
    await fs.promises.writeFile(
      path.join(runDir, 'transcript.md'),
      `# Stage 4 A1\n\nShopper: ${shopperText}\n\nConcierge: ${replyText || '[no reply rendered]'}\n\nResult: ${outcome.status}: ${outcome.detail}\n`,
    );
  }

  expect(outcome.status, outcome.detail).toBe('partial');
});
