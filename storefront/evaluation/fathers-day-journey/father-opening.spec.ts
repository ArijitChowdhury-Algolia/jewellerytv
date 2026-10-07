import { expect, test, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { repeatedExactTextAfterTool } from './assistantTextIntegrity';

// Scenario inventory before test code, per TestingSOPs:
// 1. F1 open-ended gratitude/surprise gift: generated person-first response;
//    no premature product retrieval/cards or category/specification menu.
// 2. F2 surprise + old black/steel watch + pool/bracelet context: keep the
//    mission and preferences; do not infer that Dad swims wearing the watch.
// 3. F3 admired brown leather versus familiar black/steel + firm $350 total:
//    state before retrieval, real first-quality watch cards listed in stock
//    and not above the item ceiling.
// 4. Missing reply, guardrail/system notice, failed/aborted continuation,
//    missing product identity, pre-owned/unavailable/over-budget card, request
//    exhaustion and unexpected source are first failures, never passes.
// 5. Later F4-F12 remain a separate full-journey window after this gate.
// Diagnostic mode is never an acceptance pass. An HTTP-200 net::ERR_ABORTED
// after a rendered reply and a new completed-assistant receipt is a transport
// observation unknown, never success. A no-paid full-path SSE fixture verified
// that this browser-capture signal can coexist with successful SDK completion;
// a broken SSE produced no receipt/reply. Any other failure still halts.

const live = process.env.JTV_RUN_FATHER_OPENING === '1';
const diagnosticContinue = process.env.JTV_FATHER_DIAGNOSTIC_CONTINUE === '1';
const resumeSessionFile = process.env.JTV_FATHER_RESUME_SESSION ?? '';
const resumedF3 = !!resumeSessionFile;
const maxRequests = Number(process.env.JTV_MAX_COMPLETION_REQUESTS);
const budgetReady = Number.isSafeInteger(maxRequests) && maxRequests === (resumedF3 ? 5 : 15);
const intercepted = ['/api/chat', '/api/agent-evidence', '/api/agent-product-refresh', '/api/products/'];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const frozenSourceFiles = [
  'storefront/src/concierge/ConnectedConcierge.tsx',
  'storefront/src/concierge/sdkTools.ts',
  'storefront/src/concierge/toolRuntime.ts',
  'storefront/src/concierge/ConciergeWorkspaceProvider.tsx',
  'storefront/src/ProductWorkspace.tsx',
  'storefront/server/api.ts',
  'storefront/server/concierge/retrieveEvidence.ts',
  'storefront/shared/concierge/state/updateShoppingState.ts',
] as const;
const runDir = path.join(
  repoRoot,
  '.checkpoint',
  'runs',
  `${resumedF3 ? 'fathers-day-resumed-f3' : diagnosticContinue ? 'fathers-day-diagnostic' : 'fathers-day-opening'}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

type RequestRecord = {
  turn: string | null;
  url: string;
  method: string;
  requestBody: string | null;
  status: number | null;
  responseFile: string | null;
  failed: boolean;
  networkFailure: string | null;
  captureError: string | null;
  at: string;
};
type Card = { id: string; title: string; price: string; availability: string; text: string };
type Turn = {
  id: string;
  shopper: string;
  reply: string;
  notices: string[];
  cards: Card[];
  failedRequests: string[];
  captureErrors: string[];
  completedReceipt: boolean;
  repeatedExactText: string | null;
  sessionFile: string | null;
  completionRequests: number;
  evidenceRequests: number;
  retrievalRequests: number;
  elapsedMs: number;
  error?: string;
};

function git(args: string[]) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}

function sourceHashes() {
  return Object.fromEntries(
    frozenSourceFiles.map((name) => [
      name,
      createHash('sha256').update(fs.readFileSync(path.join(repoRoot, name))).digest('hex'),
    ]),
  );
}

function cardSnapshot(page: Page) {
  return page.locator('.pw-discover .pw-product').evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute('data-product-id') ?? '',
      title: node.querySelector('h3')?.textContent?.trim() ?? '',
      price: node.querySelector('.pw-price')?.textContent?.trim() ?? '',
      availability: node.querySelector('.pw-evidence small')?.textContent?.trim() ?? '',
      text: (node.textContent ?? '').slice(0, 800),
    })),
  );
}

function numericPrice(price: string): number | null {
  const match = price.replace(/,/g, '').match(/\$\s*(\d+(?:\.\d{2})?)/);
  return match ? Number(match[1]) : null;
}

function completedReceiptCount(page: Page) {
  return page.evaluate(() => {
    let count = 0;
    for (const [key, raw] of Object.entries(sessionStorage)) {
      if (!key.startsWith('jtv-concierge-completed-')) continue;
      try {
        const parsed = JSON.parse(raw) as { assistantMessageIds?: unknown };
        if (Array.isArray(parsed.assistantMessageIds)) count += parsed.assistantMessageIds.length;
      } catch {
        // A malformed receipt is not completion evidence.
      }
    }
    return count;
  });
}

test('Father F1-F3 connected opening and first discovery', async ({ browser }) => {
  test.skip(!live, 'Paid Father journey is opt-in; no connected call runs by default.');
  test.skip(!budgetReady, `Set JTV_MAX_COMPLETION_REQUESTS=${resumedF3 ? 5 : 15} for this bounded Father window.`);

  fs.mkdirSync(runDir, { recursive: true });
  const context = await browser.newContext();
  let resumeMissionId: string | null = null;
  if (resumedF3) {
    const allowedRoot = path.join(repoRoot, '.checkpoint', 'runs') + path.sep;
    const resolved = path.resolve(resumeSessionFile);
    if (!resolved.startsWith(allowedRoot) || path.basename(resolved) !== 'F2-session.json')
      throw new Error('Father resume requires an F2-session.json snapshot under .checkpoint/runs.');
    const saved = JSON.parse(fs.readFileSync(resolved, 'utf8')) as Record<string, string>;
    resumeMissionId = (JSON.parse(saved['jtv.shopping.v3'] ?? '{}') as { missionId?: string }).missionId ?? null;
    if (!resumeMissionId) throw new Error('Father F2 snapshot has no mission identity.');
    await context.addInitScript((entries) => {
      try {
        for (const [key, value] of Object.entries(entries)) sessionStorage.setItem(key, value);
      } catch {
        // The init script also runs on about:blank, where storage may be denied.
      }
    }, saved);
  }
  const page = await context.newPage();
  const requests: RequestRecord[] = [];
  const sourceBefore = sourceHashes();
  const pending: Promise<void>[] = [];
  const turns: Turn[] = [];
  const assertions: Array<{ id: string; status: 'pass' | 'fail' | 'unknown' | 'not-run'; detail: string }> = [];
  let activeTurn: string | null = null;
  let completionCount = 0;
  let budgetStopped = false;
  let firstFailure: string | null = null;

  const recordAssertion = (
    id: string,
    status: 'pass' | 'fail' | 'unknown' | 'not-run',
    detail: string,
  ) => {
    assertions.push({ id, status, detail });
    if (status === 'fail' && !firstFailure) firstFailure = id;
  };

  const transportAssessment = (turn: Turn) => {
    if (!turn.failedRequests.length && !turn.captureErrors.length) {
      return { transport: 'pass' as const, capture: 'pass' as const };
    }
    const observedAbortOnly =
      !!turn.reply &&
      turn.completedReceipt &&
      turn.notices.length === 0 &&
      turn.failedRequests.length > 0 &&
      turn.failedRequests.every((failure) => failure.includes('net::ERR_ABORTED'));
    return {
      transport: observedAbortOnly ? ('unknown' as const) : turn.failedRequests.length ? ('fail' as const) : ('pass' as const),
      capture: observedAbortOnly ? ('unknown' as const) : turn.captureErrors.length ? ('fail' as const) : ('pass' as const),
    };
  };

  await page.route('**/api/chat', async (route) => {
    completionCount += 1;
    if (completionCount > maxRequests) {
      budgetStopped = true;
      await route.abort();
      return;
    }
    await route.continue();
  });

  page.on('request', (request: Request) => {
    if (!intercepted.some((part) => request.url().includes(part))) return;
    const turn = activeTurn;
    const index = requests.length;
    const record: RequestRecord = {
      turn,
      url: request.url(),
      method: request.method(),
      requestBody: request.postData(),
      status: null,
      responseFile: null,
      failed: false,
      networkFailure: null,
      captureError: null,
      at: new Date().toISOString(),
    };
    requests.push(record);
    pending.push(
      (async () => {
        try {
          const response = await request.response();
          record.status = response?.status() ?? null;
          if (!response) {
            record.failed = true;
            return;
          }
          const endpoint = request.url().includes('/api/chat')
            ? 'chat'
            : request.url().includes('/api/agent-evidence')
              ? 'evidence'
              : request.url().includes('/api/agent-product-refresh')
                ? 'refresh'
                : 'product';
          const name = `${turn ?? 'outside'}-${index}-${endpoint}.txt`;
          fs.writeFileSync(path.join(runDir, name), await response.body());
          record.responseFile = name;
        } catch (error) {
          record.captureError = String(error);
          record.networkFailure = request.failure()?.errorText ?? null;
          record.failed = record.networkFailure !== null || record.status === null;
        }
      })(),
    );
  });

  const run = async (id: string, shopper: string): Promise<Turn> => {
    const started = Date.now();
    const fromPending = pending.length;
    const fromRequests = requests.length;
    const fromCompletions = completionCount;
    const beforeReplies = await page.locator('.connected-assistant-message').count();
    const beforeNotices = await page.locator('.connected-system-notice').count();
    const beforeCompletedReceipts = await completedReceiptCount(page);
    const turn: Turn = {
      id,
      shopper,
      reply: '',
      notices: [],
      cards: [],
      failedRequests: [],
      captureErrors: [],
      completedReceipt: false,
      repeatedExactText: null,
      sessionFile: null,
      completionRequests: 0,
      evidenceRequests: 0,
      retrievalRequests: 0,
      elapsedMs: 0,
    };
    turns.push(turn);
    activeTurn = id;
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    try {
      const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
      await input.fill(shopper);
      await panel.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(input).toBeDisabled({ timeout: 10_000 });
      await expect(input).toBeEnabled({ timeout: 180_000 });
      await expect
        .poll(
          async () =>
            (await panel.locator('.connected-assistant-message').count()) > beforeReplies ||
            (await panel.locator('.connected-system-notice').count()) > beforeNotices,
          { timeout: 8_000 },
        )
        .toBe(true);
      const replyCount = await panel.locator('.connected-assistant-message').count();
      if (replyCount > beforeReplies)
        turn.reply = (await panel.locator('.connected-assistant-message').last().innerText()).trim();
      turn.notices = await panel.locator('.connected-system-notice').allTextContents();
      turn.cards = await cardSnapshot(page);
    } catch (error) {
      turn.error = String(error);
    } finally {
      // Failure screenshots and visible state matter most when no reply arrives.
      try {
        if (!turn.reply && (await panel.locator('.connected-assistant-message').count()) > beforeReplies)
          turn.reply = (await panel.locator('.connected-assistant-message').last().innerText()).trim();
        turn.notices = await panel.locator('.connected-system-notice').allTextContents();
        turn.cards = await cardSnapshot(page);
        await page.screenshot({ path: path.join(runDir, `${id}-viewport.png`), fullPage: false });
        await panel
          .getByRole('region', { name: 'Shopping choices' })
          .screenshot({ path: path.join(runDir, `${id}-workspace.png`) });
      } catch (snapshotError) {
        turn.error = `${turn.error ?? ''} | snapshot: ${String(snapshotError)}`.trim();
      }
      activeTurn = null;
      await Promise.allSettled(pending.slice(fromPending));
      const turnRequests = requests.slice(fromRequests);
      turn.failedRequests = turnRequests
        .filter((record) => record.failed || record.status === null || record.status < 200 || record.status >= 300)
        .map((record) => `${record.method} ${record.url} status=${record.status ?? 'none'} failure=${record.networkFailure ?? 'none'}`);
      turn.captureErrors = turnRequests
        .filter((record) => record.captureError)
        .map((record) => `${record.method} ${record.url}: ${record.captureError}`);
      turn.completionRequests = completionCount - fromCompletions;
      turn.evidenceRequests = turnRequests.filter((record) => record.url.includes('/api/agent-evidence')).length;
      turn.retrievalRequests = turnRequests.filter((record) =>
        ['/api/agent-evidence', '/api/agent-product-refresh', '/api/products/'].some((part) =>
          record.url.includes(part),
        ),
      ).length;
      try {
        const session = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
        turn.completedReceipt = (await completedReceiptCount(page)) > beforeCompletedReceipts;
        if (turn.reply) {
          const messages = JSON.parse(session['instantsearch-chat-initial-messages'] ?? '[]') as Array<{
            role?: string;
            parts?: Array<{ type?: string; text?: string }>;
          }>;
          const latest = [...messages].reverse().find((message) => message.role === 'assistant');
          turn.repeatedExactText = latest ? repeatedExactTextAfterTool(latest) : null;
        }
        turn.sessionFile = `${id}-session.json`;
        fs.writeFileSync(path.join(runDir, turn.sessionFile), JSON.stringify(session, null, 2));
      } catch (sessionError) {
        turn.error = `${turn.error ?? ''} | session: ${String(sessionError)}`.trim();
      }
      turn.elapsedMs = Date.now() - started;
      fs.writeFileSync(path.join(runDir, `${id}.json`), JSON.stringify(turn, null, 2));
    }
    return turn;
  };

  const assessF3 = (f3: Turn, previousCards: Card[]) => {
    if (budgetStopped)
      recordAssertion('F3-budget-exhausted', 'fail', `attempted ${completionCount} completion requests against cap ${maxRequests}`);
    recordAssertion('F3-reply', f3.reply ? 'pass' : 'fail', f3.reply ? 'generated reply rendered' : 'no reply');
    recordAssertion(
      'F3-no-repeated-answer',
      f3.reply ? (f3.repeatedExactText ? 'fail' : 'pass') : 'not-run',
      f3.repeatedExactText ? `repeated after a tool: ${f3.repeatedExactText.slice(0, 120)}` : 'no exact long-form repetition',
    );
    recordAssertion(
      'F3-completed-receipt',
      f3.completedReceipt ? 'pass' : 'fail',
      f3.completedReceipt ? 'mission-scoped assistant receipt advanced' : 'no new completed assistant receipt',
    );
    recordAssertion('F3-notice', f3.notices.length === 0 ? 'pass' : 'fail', `${f3.notices.length} system notices`);
    const transport = transportAssessment(f3);
    recordAssertion('F3-transport', transport.transport, f3.failedRequests.join('; ') || 'all captured requests succeeded');
    recordAssertion('F3-capture', transport.capture, f3.captureErrors.join('; ') || 'all response bodies captured');

    const published = !!f3.reply && f3.completedReceipt && f3.notices.length === 0 && !budgetStopped;
    if (published) {
      recordAssertion('F3-cards', f3.cards.length > 0 ? 'pass' : 'fail', `${f3.cards.length} Discover cards`);
      const badCards = f3.cards.filter(
        (card) =>
          !card.id ||
          /pre[- ]owned/i.test(card.title) ||
          card.availability !== 'Listed in stock' ||
          numericPrice(card.price) === null ||
          (numericPrice(card.price) ?? Infinity) > 350,
      );
      recordAssertion(
        'F3-visible-gift-boundaries',
        badCards.length === 0 && f3.cards.length > 0 ? 'pass' : 'fail',
        `unresolved/pre-owned/unavailable/over-budget cards: ${badCards.map((card) => card.id).join(', ') || 'none'}`,
      );
      recordAssertion(
        'F3-product-evidence',
        'unknown',
        'bind each visible ID to exact prod_catalog record; verify condition, stock, price and claimed dial/band facts',
      );
    } else {
      recordAssertion('F3-new-proposal', 'not-run', 'turn did not commit; visible cards are prior Discover state');
      const priorIds = previousCards.map((card) => card.id);
      const afterIds = f3.cards.map((card) => card.id);
      recordAssertion(
        'F3-prior-state-preserved',
        JSON.stringify(priorIds) === JSON.stringify(afterIds) ? 'pass' : 'fail',
        `before=${priorIds.join(',')} after=${afterIds.join(',')}`,
      );
      recordAssertion('F3-product-evidence', 'not-run', 'no newly committed F3 cards to validate');
    }
    if (f3.error) recordAssertion('F3-browser', 'fail', f3.error);
  };

  try {
    const health = await page.request.get('/api/health');
    fs.writeFileSync(path.join(runDir, 'health.json'), await health.text());
    await page.goto('/');
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toBeVisible();

    if (resumedF3) {
      const restoredMission = await page.evaluate(() => {
        try {
          return (JSON.parse(sessionStorage.getItem('jtv.shopping.v3') ?? '{}') as { missionId?: string }).missionId ?? null;
        } catch {
          return null;
        }
      });
      recordAssertion(
        'resume-mission',
        restoredMission === resumeMissionId ? 'pass' : 'fail',
        `expected ${resumeMissionId}, observed ${restoredMission}`,
      );
      try {
        await expect
          .poll(() => panel.locator('.connected-assistant-message').count(), { timeout: 10_000 })
          .toBeGreaterThanOrEqual(2);
      } catch {
        // The assertion below records a missing restored transcript as a failure.
      }
      const restoredReplies = await panel.locator('.connected-assistant-message').count();
      recordAssertion(
        'resume-transcript',
        restoredReplies >= 2 ? 'pass' : 'fail',
        `${restoredReplies} earlier assistant replies visible`,
      );
      if (!firstFailure) {
        const beforeF3Cards = await cardSnapshot(page);
        const f3 = await run(
          'F3',
          "I've seen him admire brown leather watches. Maybe that's the change, as long as the face isn't huge or busy. I can spend up to $350 for the whole gift.",
        );
        assessF3(f3, beforeF3Cards);
      }
    } else {

    const f1 = await run(
      'F1',
      "Father's Day is coming up. Dad always says not to get him anything, but he's always been there for me. He loves watches, and I want to get him one he'd actually wear. I have no idea where to begin.",
    );
    recordAssertion('F1-reply', f1.reply ? 'pass' : 'fail', f1.reply ? 'generated reply rendered' : 'no reply');
    recordAssertion(
      'F1-no-repeated-answer',
      f1.reply ? (f1.repeatedExactText ? 'fail' : 'pass') : 'not-run',
      f1.repeatedExactText ? `repeated after a tool: ${f1.repeatedExactText.slice(0, 120)}` : 'no exact long-form repetition',
    );
    recordAssertion('F1-completed-receipt', f1.completedReceipt ? 'pass' : 'fail', f1.completedReceipt ? 'mission-scoped assistant receipt advanced' : 'no new completed assistant receipt');
    recordAssertion('F1-notice', f1.notices.length === 0 ? 'pass' : 'fail', `${f1.notices.length} system notices`);
    const f1Transport = transportAssessment(f1);
    recordAssertion('F1-transport', f1Transport.transport, f1.failedRequests.join('; ') || 'all captured requests succeeded');
    recordAssertion('F1-capture', f1Transport.capture, f1.captureErrors.join('; ') || 'all response bodies captured');
    recordAssertion(
      'F1-no-premature-retrieval',
      f1.retrievalRequests === 0 && f1.cards.length === 0 ? 'pass' : 'fail',
      `${f1.retrievalRequests} retrieval calls; ${f1.cards.length} Discover cards`,
    );
    recordAssertion('F1-person-first', 'unknown', 'independent semantic review of first two sentences');
    if (f1.error) recordAssertion('F1-browser', 'fail', f1.error);

    if (!firstFailure && !budgetStopped) {
      const f2 = await run(
        'F2',
        "A complete surprise. He'd tell me to save my money. He still wears the same black-dial watch with a steel bracelet, even when he takes my daughter to the pool on Saturdays. Sometimes he adds a plain steel bracelet on his other wrist.",
      );
      recordAssertion('F2-reply', f2.reply ? 'pass' : 'fail', f2.reply ? 'generated reply rendered' : 'no reply');
      recordAssertion(
        'F2-no-repeated-answer',
        f2.reply ? (f2.repeatedExactText ? 'fail' : 'pass') : 'not-run',
        f2.repeatedExactText ? `repeated after a tool: ${f2.repeatedExactText.slice(0, 120)}` : 'no exact long-form repetition',
      );
      recordAssertion('F2-completed-receipt', f2.completedReceipt ? 'pass' : 'fail', f2.completedReceipt ? 'mission-scoped assistant receipt advanced' : 'no new completed assistant receipt');
      recordAssertion('F2-notice', f2.notices.length === 0 ? 'pass' : 'fail', `${f2.notices.length} system notices`);
      const f2Transport = transportAssessment(f2);
      recordAssertion('F2-transport', f2Transport.transport, f2.failedRequests.join('; ') || 'all captured requests succeeded');
      recordAssertion('F2-capture', f2Transport.capture, f2.captureErrors.join('; ') || 'all response bodies captured');
      recordAssertion(
        'F2-discovery-timing',
        f2.retrievalRequests === 0 && f2.cards.length === 0 ? 'pass' : 'unknown',
        `${f2.retrievalRequests} retrieval calls; ${f2.cards.length} cards before brown-leather contrast and budget. Early exploration needs independent usefulness/grounding review, not an exact-script order assertion.`,
      );
      if (f2.cards.length)
        recordAssertion('F2-card-grounding', 'unknown', 'bind displayed IDs to exact records and assess gift suitability before calling early exploration useful');
      recordAssertion('F2-continuity', 'unknown', 'review accepted brief and generated references to black/steel watch, pool and bracelet');
      if (f2.error) recordAssertion('F2-browser', 'fail', f2.error);
    } else recordAssertion('F2-not-run', 'not-run', 'halted after F1 first failure or budget stop');

    if (!firstFailure && !budgetStopped) {
      const beforeF3Cards = await cardSnapshot(page);
      const f3 = await run(
        'F3',
        "I've seen him admire brown leather watches. Maybe that's the change, as long as the face isn't huge or busy. I can spend up to $350 for the whole gift.",
      );
      assessF3(f3, beforeF3Cards);
    } else recordAssertion('F3-not-run', 'not-run', 'halted after first failure or budget stop');
    }
  } finally {
    await Promise.allSettled(pending);
    const sourceAfter = sourceHashes();
    const drift = frozenSourceFiles.filter((name) => sourceBefore[name] !== sourceAfter[name]);
    recordAssertion('frozen-source', drift.length ? 'fail' : 'pass', drift.join(', ') || 'runtime source hashes stable');
    if (budgetStopped) recordAssertion('request-budget', 'fail', `attempted ${completionCount} requests against cap ${maxRequests}`);
    const unknownCount = assertions.filter((assertion) => assertion.status === 'unknown').length;
    const verdict = diagnosticContinue || resumedF3
      ? firstFailure
        ? 'diagnostic-fail'
        : 'diagnostic-needs-independent-review'
      : firstFailure
        ? 'fail'
        : unknownCount
          ? 'needs-independent-review'
          : 'mechanical-pass';
    const readbacks = fs
      .readdirSync(path.join(repoRoot, 'storefront', 'evidence'))
      .filter((name) => /^agent-.*\.json$/.test(name))
      .sort();
    const latestReadback = readbacks.at(-1) ?? null;
    let latestSavedAgentReadback: unknown = null;
    if (latestReadback) {
      try {
        const snapshot = JSON.parse(
          fs.readFileSync(path.join(repoRoot, 'storefront', 'evidence', latestReadback), 'utf8'),
        );
        latestSavedAgentReadback = { path: `storefront/evidence/${latestReadback}`, agentId: snapshot.agentId, hashes: snapshot.hashes };
      } catch {
        latestSavedAgentReadback = { path: `storefront/evidence/${latestReadback}`, status: 'unreadable' };
      }
    }
    const report = {
      journey: 'fathers-day-opening',
      mode: resumedF3 ? 'F3-resumed-after-F2-failure' : diagnosticContinue ? 'F2-F3-after-known-F1-failure' : 'acceptance',
      resumeMissionId,
      priorFirstFailure: diagnosticContinue || resumedF3 ? 'fathers-day-opening-2026-10-07T08-29-43-833Z/F1-person-first and fathers-day-diagnostic-2026-10-07T08-45-22-594Z/F2-curation' : null,
      at: new Date().toISOString(),
      verdict,
      app: { head: git(['rev-parse', 'HEAD']), originMain: git(['rev-parse', 'origin/main']), status: git(['status', '--short']) },
      sourceBefore,
      sourceAfter,
      latestSavedAgentReadback,
      runtimeAgentIdentity: 'verify separately against selected server configuration; not established by this readback alone',
      maxCompletionRequests: maxRequests,
      completionRequests: completionCount,
      budgetStopped,
      firstFailure,
      assertions,
      turns,
      requests,
    };
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2));
    await context.close();
  }
  expect(firstFailure, `First Father failure retained at ${runDir}`).toBeNull();
  expect(diagnosticContinue || resumedF3, `Diagnostic-only run cannot accept Father journey; receipts at ${runDir}`).toBe(false);
  expect(
    assertions.filter((assertion) => assertion.status === 'unknown'),
    `Mechanical capture needs independent semantic and product-evidence review at ${runDir}`,
  ).toHaveLength(0);
});
