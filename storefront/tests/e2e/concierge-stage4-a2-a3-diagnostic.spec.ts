import { expect, test, type Request } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const live = process.env.JTV_RUN_STAGE4_A2_A3 === '1';
const requestCap = Number(process.env.JTV_MAX_COMPLETION_REQUESTS ?? 30);
const runDir = process.env.JTV_STAGE4_RUN_DIR;
const agentSnapshotPath = process.env.JTV_STAGE4_AGENT_SNAPSHOT;
const turns = [
  {
    beat: 'A1',
    input:
      "I want to buy a gift for my wife for our 10th anniversary, but I don't know where to start. She likes white gold and restrained designs. Nothing flashy, just a classy, timeless piece. My budget is $500. Help me.",
  },
  {
    beat: 'A2',
    input:
      "Little studs and her wedding ring, mostly. I'd love another ring for her, but I have no idea what size.",
  },
  { beat: 'A3', input: 'She loves blue. Subtle blue, though.' },
];

type NetworkRecord = {
  url: string;
  requestBody: string | null;
  status: number | null;
  responseBody: string | null;
  loadingFinished: boolean;
  loadingFailure: string | null;
  bodyCaptureError: string | null;
  sseDone: boolean;
  at: string;
};

async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(absolute)));
    else if (/\.(ts|tsx|js|mjs|css|json)$/.test(entry.name)) found.push(absolute);
  }
  return found;
}

async function pin(repoRoot: string) {
  const storefront = path.join(repoRoot, 'storefront');
  const files = [
    ...(await filesUnder(path.join(storefront, 'src'))),
    ...(await filesUnder(path.join(storefront, 'shared'))),
    ...(await filesUnder(path.join(storefront, 'server'))),
    path.join(storefront, 'vite.config.ts'),
  ].sort();
  const hashes: Record<string, string> = {};
  for (const file of files) {
    hashes[path.relative(repoRoot, file)] = createHash('sha256')
      .update(await fs.promises.readFile(file))
      .digest('hex');
  }
  if (!agentSnapshotPath) throw new Error('Set JTV_STAGE4_AGENT_SNAPSHOT.');
  const snapshot = await fs.promises.readFile(agentSnapshotPath);
  const evidenceDir = path.join(storefront, 'evidence');
  const latest = (await fs.promises.readdir(evidenceDir))
    .filter((name) => /^agent-\d{4}-\d{2}-\d{2}T.*\.json$/.test(name))
    .sort()
    .at(-1);
  if (latest !== path.basename(agentSnapshotPath)) {
    throw new Error(`Pinned agent readback is stale; latest is ${latest ?? 'missing'}.`);
  }
  return {
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    runtimeHashes: hashes,
    agentSnapshot: {
      path: path.relative(repoRoot, agentSnapshotPath),
      sha256: createHash('sha256').update(snapshot).digest('hex'),
    },
  };
}

test('A2/A3 continuation diagnostic, not Stage 4 acceptance', async ({ page, context }) => {
  test.skip(!live, 'Paid diagnostic is opt-in (JTV_RUN_STAGE4_A2_A3=1).');
  test.skip(!runDir, 'Set a unique JTV_STAGE4_RUN_DIR.');
  test.skip(!Number.isSafeInteger(requestCap) || requestCap < 1, 'Set a positive completion cap.');
  if (!runDir) {
    test.skip(true, 'Set a unique JTV_STAGE4_RUN_DIR.');
    return;
  }
  const outputDir = runDir;
  test.setTimeout(12 * 60_000);
  fs.mkdirSync(outputDir, { recursive: true });
  const repoRoot = path.resolve(process.cwd(), '..');
  const runtimeStart = await pin(repoRoot);
  await fs.promises.writeFile(
    path.join(outputDir, 'runtime-pin-start.json'),
    JSON.stringify(runtimeStart, null, 2),
  );

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const network = new Map<string, NetworkRecord>();
  const pendingNetworkRecords = new Map<string, NetworkRecord[]>();
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (!/\/api\/(chat|agent-evidence)/.test(request.url)) return;
    const record: NetworkRecord = {
      url: request.url,
      requestBody: request.postData ?? null,
      status: null,
      responseBody: null,
      loadingFinished: false,
      loadingFailure: null,
      bodyCaptureError: null,
      sseDone: false,
      at: new Date().toISOString(),
    };
    network.set(requestId, record);
    const queue = pendingNetworkRecords.get(request.url) ?? [];
    queue.push(record);
    pendingNetworkRecords.set(request.url, queue);
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    const record = network.get(requestId);
    if (record) record.status = response.status;
  });
  cdp.on('Network.loadingFinished', ({ requestId }) => {
    const record = network.get(requestId);
    if (record) record.loadingFinished = true;
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
    const record = network.get(requestId);
    if (record) record.loadingFailure = errorText;
  });

  const requests = new Map<Request, NetworkRecord>();
  page.on('request', (request) => {
    const queue = pendingNetworkRecords.get(request.url());
    const record = queue?.shift();
    if (record) requests.set(request, record);
  });
  const bodyReads: Promise<void>[] = [];
  page.on('response', (response) => {
    const record = requests.get(response.request());
    if (!record) return;
    bodyReads.push(
      (async () => {
        try {
          const body = await response.text();
          record.responseBody = body.slice(0, 1_000_000);
          record.sseDone = body.includes('data: [DONE]');
        } catch (error) {
          record.bodyCaptureError = error instanceof Error ? error.message : String(error);
        }
      })(),
    );
  });

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 600));
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message.slice(0, 600)));

  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
  const reply = panel.locator('.connected-assistant-message');
  const notices = panel.locator('.connected-system-notice');
  const beatEvidence: Array<Record<string, unknown>> = [];
  const startTime = Date.now();
  let completionRequests = 0;
  let stopReason: string | null = null;
  await page.route('**/api/chat', async (route) => {
    completionRequests += 1;
    if (completionRequests > requestCap) {
      stopReason = `completion cap ${requestCap} reached`;
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    await expect(input).toBeVisible();
    await page.screenshot({ path: path.join(outputDir, '00-open.png') });

    for (const turn of turns) {
      const beforeReplyCount = await reply.count();
      const cardsBefore = await page.locator('.pw-discover .pw-product').evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute('data-product-id'),
          text: (node.textContent ?? '').trim(),
        })),
      );
      const beforeReceipt = await page.evaluate(() => {
        const key = Object.keys(sessionStorage).find((name) =>
          name.startsWith('jtv-concierge-completed-'),
        );
        return key ? JSON.parse(sessionStorage.getItem(key) ?? 'null') : null;
      });
      const beforeIds = new Set<string>(beforeReceipt?.assistantMessageIds ?? []);
      const turnStartedAt = Date.now();
      await input.fill(turn.input);
      await panel.getByRole('button', { name: 'Send', exact: true }).click();
      try {
        await expect
          .poll(
            async () => {
              const currentCount = await reply.count();
              const ready = await input.isEnabled();
              const receipt = await page.evaluate(() => {
                const key = Object.keys(sessionStorage).find((name) =>
                  name.startsWith('jtv-concierge-completed-'),
                );
                return key ? JSON.parse(sessionStorage.getItem(key) ?? 'null') : null;
              });
              const newIds = (receipt?.assistantMessageIds ?? []).filter(
                (id: string) => !beforeIds.has(id),
              );
              return ready && currentCount > beforeReplyCount && newIds.length > 0;
            },
            { timeout: 180_000 },
          )
          .toBe(true);
      } catch {
        stopReason = `${turn.beat}: no visible completed assistant reply and completion receipt`;
      }

      const receipt = await page.evaluate(() => {
        const key = Object.keys(sessionStorage).find((name) =>
          name.startsWith('jtv-concierge-completed-'),
        );
        return key ? JSON.parse(sessionStorage.getItem(key) ?? 'null') : null;
      });
      const currentIds = new Set<string>(receipt?.assistantMessageIds ?? []);
      const completedIds = [...currentIds].filter((id) => !beforeIds.has(id));
      const allReplies = await reply.allTextContents();
      const visibleReply = allReplies.at(-1)?.trim() ?? '';
      const storage = await page.evaluate(() => {
        const raw = sessionStorage.getItem('jtv.shopping.v3');
        if (!raw) return null;
        const state = JSON.parse(raw);
        return {
          missionId: state.missionId,
          revision: state.brief?.revision,
          facts: state.brief?.facts,
          activeView: state.activeView,
          productIds: (state.products ?? []).map((item: any) => item.product?.id),
          compareIds: state.compareIds,
          combinationIds: state.combinationIds,
        };
      });
      const evidenceRequests = [...network.values()].filter(
        (item) =>
          item.at >= new Date(turnStartedAt).toISOString() &&
          item.url.includes('/api/agent-evidence'),
      );
      const cardsAfter = await page.locator('.pw-discover .pw-product').evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute('data-product-id'),
          text: (node.textContent ?? '').trim(),
        })),
      );
      beatEvidence.push({
        beat: turn.beat,
        input: turn.input,
        visibleReply,
        completedAssistantMessageIds: completedIds,
        completionReceipt: receipt,
        systemNotices: await notices.allTextContents(),
        state: storage,
        evidenceRequests,
        cardsBefore,
        cardsAfter,
        cardsChanged: JSON.stringify(cardsBefore) !== JSON.stringify(cardsAfter),
        elapsedMs: Date.now() - turnStartedAt,
      });
      await page.screenshot({ path: path.join(outputDir, `${turn.beat}-after.png`) });
      if (stopReason) break;
      if (!visibleReply || !completedIds.length || (await notices.count()) > 0) {
        stopReason = `${turn.beat}: visible reply, completion receipt, or system-notice check failed`;
        break;
      }
      if (consoleErrors.length) {
        stopReason = `${turn.beat}: browser console error observed`;
        break;
      }
    }
  } catch (error) {
    stopReason = error instanceof Error ? error.message : String(error);
  } finally {
    await Promise.race([
      Promise.all(bodyReads),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    const runtimeEnd = await pin(repoRoot);
    if (JSON.stringify(runtimeStart) !== JSON.stringify(runtimeEnd)) {
      stopReason ??= 'runtime or saved-agent snapshot changed during this diagnostic';
    }
    const records = [...network.values()];
    const summary = {
      label: 'A2/A3 diagnostic only, not Stage 4 acceptance',
      capturedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startTime,
      baseURL: process.env.JTV_E2E_BASE_URL ?? 'http://localhost:5173',
      requestCap,
      completionRequests,
      runtimeStart,
      runtimeEnd,
      beatEvidence,
      network: records,
      consoleErrors,
      stopReason,
      noStage4Acceptance: true,
    };
    await fs.promises.writeFile(
      path.join(outputDir, 'summary.json'),
      JSON.stringify(summary, null, 2),
    );
    await fs.promises.writeFile(
      path.join(outputDir, 'transcript.md'),
      beatEvidence
        .map(
          (item) =>
            `## ${item.beat}\n\nShopper: ${item.input}\n\nConcierge: ${item.visibleReply || '[no visible reply]'}\n`,
        )
        .join('\n'),
    );
    await fs.promises.writeFile(
      path.join(outputDir, 'runtime-pin-end.json'),
      JSON.stringify(runtimeEnd, null, 2),
    );
  }

  expect(stopReason, 'Diagnostic stops at the first mechanical failure.').toBeNull();
  expect(beatEvidence).toHaveLength(3);
});
