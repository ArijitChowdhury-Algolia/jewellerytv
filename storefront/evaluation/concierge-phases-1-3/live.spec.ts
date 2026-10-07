import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type Locator } from '@playwright/test';
import manifest from './scenario-manifest.json' with { type: 'json' };
import {
  CampaignLedger,
  classifyRequestKind,
  evaluateTurnCompletion,
} from './accounting.mjs';

const live = process.env.JTV_RUN_LIVE_CONCIERGE_E2E === '1';
const requestedBudget = Number(process.env.JTV_MAX_COMPLETION_REQUESTS);
const budgetReady = Number.isSafeInteger(requestedBudget) && requestedBudget > 0;
// Declared in the manifest from the phase 3 test plan deadlines.
const replyTimeoutMs = manifest.execution.deadlines.liveReplySeconds * 1000;
const uiActionTimeoutMs = manifest.execution.deadlines.uiActionSeconds * 1000;
// Reserved wording variants run only when explicitly flagged; they consume the
// same budget and never replace the original recorded wording in the manifest.
const runVariants = process.env.JTV_WORDING_VARIANTS === '1';
const variantFor = (scenarioId: string, turnIndex: number) =>
  runVariants
    ? (manifest.execution.wordingVariantsDeclared ?? []).find(
        (variant) => variant.forScenarioId === scenarioId && variant.turnIndex === turnIndex,
      )?.variantText
    : undefined;

type Action = {
  kind: 'save-first' | 'compare-first-saved' | 'combination-add-first';
  count: number;
};
type Turn = { text: string; expects: string[]; beforeUiActions?: Action[]; uiActions?: Action[] };
type RequestRecord = { url: string; body: string | null; status: number | null; failed: boolean };

// Reads the app's completion receipt set (jtv-concierge-completed-*) and the
// persisted chat transcript's assistant IDs from session storage. Generic over
// the transcript persistence key format.
const readCompletionSignals = (page: Page) =>
  page.evaluate(() => {
    const completedIds: string[] = [];
    const transcriptIds: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      const raw = key ? sessionStorage.getItem(key) : null;
      if (!key || !raw) continue;
      if (key.startsWith('jtv-concierge-completed-')) {
        try {
          const parsed = JSON.parse(raw) as { version?: number; assistantMessageIds?: unknown };
          if (parsed?.version === 1 && Array.isArray(parsed.assistantMessageIds))
            for (const id of parsed.assistantMessageIds)
              if (typeof id === 'string') completedIds.push(id);
        } catch {
          // Unreadable receipt entries contribute nothing.
        }
      }
      if (raw.includes('"role":"assistant"')) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          const messages = Array.isArray(parsed)
            ? parsed
            : ((parsed as { messages?: unknown[] }).messages ??
              (parsed as { initialMessages?: unknown[] }).initialMessages ??
              []);
          for (const message of messages as { role?: string; id?: string }[])
            if (message?.role === 'assistant' && typeof message.id === 'string')
              transcriptIds.push(message.id);
        } catch {
          // Not the transcript; skip.
        }
      }
    }
    return { completedIds, transcriptIds };
  });

async function openConcierge(page: Page, route: string) {
  await page.goto(route);
  await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toBeVisible();
  return panel;
}

async function chooseView(workspace: Locator, name: string) {
  await workspace
    .getByRole('navigation', { name: 'Product views' })
    .getByRole('button', { name: new RegExp(`^${name}(?: \\(\\d+\\))?$`) })
    .click({ timeout: uiActionTimeoutMs });
}

async function savedCount(workspace: Locator) {
  const label = await workspace
    .getByRole('navigation', { name: 'Product views' })
    .getByRole('button', { name: /^Saved(?: \(\d+\))?$/ })
    .textContent();
  return Number(label?.match(/\((\d+)\)/)?.[1] ?? 0);
}

async function applyAction(workspace: Locator, action: Action) {
  if (!Number.isSafeInteger(action.count) || action.count < 1)
    throw new Error('Invalid UI action count.');
  if (action.kind === 'save-first') {
    await chooseView(workspace, 'Discover');
    const ids = await workspace
      .locator('.pw-product[data-product-id]')
      .evaluateAll((nodes) => [
        ...new Set(nodes.map((node) => node.getAttribute('data-product-id')).filter(Boolean)),
      ]);
    if (ids.length < action.count)
      throw new Error(
        `Scenario failure: requested ${action.count} distinct choices; only ${ids.length} are shown.`,
      );
    for (const id of ids.slice(0, action.count)) {
      // The card selector uses its verified DOM identity, not title text.
      await workspace
        .locator(`.pw-product[data-product-id="${id}"]`)
        .first()
        .getByRole('button', { name: 'Save', exact: true })
        .click({ timeout: uiActionTimeoutMs });
    }
    return;
  }
  if (action.kind === 'compare-first-saved') {
    await chooseView(workspace, 'Saved');
    const cards = workspace.locator('.pw-saved .pw-product');
    if ((await cards.count()) < action.count)
      throw new Error('Scenario failure: not enough Saved choices to compare.');
    for (let index = 0; index < action.count; index += 1) {
      await cards
        .nth(index)
        .getByRole('button', { name: 'Compare', exact: true })
        .click({ timeout: uiActionTimeoutMs });
    }
    await chooseView(workspace, 'Compare');
    await expect(workspace.locator('.pw-compare-product')).toHaveCount(action.count, {
      timeout: uiActionTimeoutMs,
    });
    return;
  }
  if (action.kind === 'combination-add-first') {
    await chooseView(workspace, 'Saved');
    const cards = workspace.locator('.pw-saved .pw-product');
    if ((await cards.count()) < action.count)
      throw new Error('Scenario failure: not enough Saved choices to combine.');
    for (let index = 0; index < action.count; index += 1) {
      await cards
        .nth(index)
        .getByRole('button', { name: 'Add to combination', exact: true })
        .click({ timeout: uiActionTimeoutMs });
    }
    await chooseView(workspace, 'Combination');
    await expect(workspace.locator('.pw-compare-product[data-product-id]')).toHaveCount(
      action.count,
      { timeout: uiActionTimeoutMs },
    );
    return;
  }
  throw new Error(`Unknown UI action: ${(action as Action).kind}`);
}

async function observe(workspace: Locator, expectation: string, previousSaved: number) {
  if (expectation === 'discovery-results') {
    await chooseView(workspace, 'Discover');
    return (await workspace.locator('.pw-discover .pw-product').count()) > 0 ? 'pass' : 'fail';
  }
  if (expectation === 'saved-count-at-least-5' || expectation === 'saved-count-increases') {
    const count = await savedCount(workspace);
    return expectation === 'saved-count-at-least-5'
      ? count >= 5
        ? 'pass'
        : 'fail'
      : count > previousSaved
        ? 'pass'
        : 'fail';
  }
  if (expectation === 'comparison-state' || expectation === 'comparison-refreshed') {
    await chooseView(workspace, 'Compare');
    return (await workspace.locator('.pw-compare-product').count()) >= 2 ? 'pass' : 'fail';
  }
  if (expectation === 'combination-state') {
    await chooseView(workspace, 'Combination');
    return (await workspace.locator('.pw-compare-product[data-product-id]').count()) >= 2
      ? 'pass'
      : 'fail';
  }
  // Interpretive requirements require an independent evidence review. They
  // remain unknown until a reviewer assesses the captured turn and sources.
  return 'unknown';
}

test('Plan 3.1 integrated campaign', async ({ browser }, testInfo) => {
  test.skip(!live, 'Paid connected journeys are opt-in.');
  test.skip(!budgetReady, 'Set an explicit cumulative completion-request budget.');
  const ledger = new CampaignLedger({ maximumCompletionRequests: requestedBudget });
  const evidence: unknown[] = [];
  // Durable per-turn receipts survive any shared test-results clean. The dir
  // is created up front so even a first-turn crash leaves a receipt trail.
  const receiptDir = path.resolve(
    process.cwd(),
    `../.checkpoint/runs/stage7-campaign-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  mkdirSync(receiptDir, { recursive: true });
  let previousReplyText: string | null = null;
  for (const scenario of manifest.scenarios) {
    if (ledger.stopped) break;
    const page = await browser.newPage();
    let activeTurn: string | null = null;
    let lastTurn: string | null = null;
    const requests: RequestRecord[] = [];
    const responses: Promise<void>[] = [];
    // Retrieval evidence responses carry the effective filters and retrieved
    // objectID set the reviewer needs; capture them alongside /api/chat.
    const evidenceResponses: { url: string; body: unknown }[] = [];
    page.on('response', (response) => {
      if (!response.url().includes('/api/agent-evidence')) return;
      const record: { url: string; body: unknown } = { url: response.url(), body: null };
      evidenceResponses.push(record);
      response
        .json()
        .then((body) => {
          record.body = body;
        })
        .catch(() => {
          record.body = null;
        });
    });
    page.on('request', (request) => {
      if (!request.url().endsWith('/api/chat')) return;
      if (!activeTurn) {
        ledger.stopForHarnessDefect('Completion request outside a shopper turn.');
        return;
      }
      const record: RequestRecord = {
        url: request.url(),
        body: request.postData(),
        status: null,
        failed: false,
      };
      requests.push(record);
      responses.push(
        request
          .response()
          .then((response) => {
            record.status = response?.status() ?? null;
            if (!response) record.failed = true;
          })
          .catch(() => {
            record.failed = true;
          }),
      );
    });
    try {
      const panel = await openConcierge(page, scenario.route);
      const workspace = panel.getByRole('region', { name: 'Shopping choices' });
      for (const [index, turn] of (scenario.turns as Turn[]).entries()) {
        const turnId = `${index + 1}`;
        lastTurn = turnId;
        const previousSaved = await savedCount(workspace);
        const previousNotices = await panel.locator('.connected-system-notice').count();
        // Captured BEFORE the send so the oracle can compute true deltas.
        const signalsBefore = await readCompletionSignals(page);
        const railCountBefore = await panel.locator('.connected-assistant-message').count();
        // For stop expectations the mechanical check is that the discover card
        // set does not grow after the shopper asks to stop.
        let preStopDiscoverCount: number | null = null;
        if (turn.expects.includes('stopping-respected')) {
          await chooseView(workspace, 'Discover');
          preStopDiscoverCount = await workspace.locator('.pw-discover .pw-product').count();
        }
        const evidenceFrom = evidenceResponses.length;
        for (const action of turn.beforeUiActions ?? []) await applyAction(workspace, action);
        ledger.startTurn(scenario.id, turnId);
        activeTurn = turnId;
        const from = requests.length;
        const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
        let retryUsed = false;
        const sendOnce = async () => {
          await input.fill(variantFor(scenario.id, index) ?? turn.text);
          await panel.getByRole('button', { name: 'Send', exact: true }).click();
          await expect(input).toBeDisabled();
          await expect(input).toBeEnabled({ timeout: replyTimeoutMs });
        };
        try {
          await sendOnce();
        } catch (error) {
          // At most one explicit transport retry per failed turn. The retry
          // consumes the same budget and its requests are accounted too.
          retryUsed = true;
          ledger.startRetry(scenario.id, turnId);
          await sendOnce();
        }
        await Promise.all(responses.slice(from));
        const observed = requests.slice(from);
        if (!observed.length)
          throw new Error(
            'Harness defect: shopper turn produced no observable completion request.',
          );
        // A transport retry fires only when the turn produced no completion
        // receipt at all. An aborted stream that still delivered a receipt and
        // a visible reply is a body-capture artifact, not a shopper failure
        // (see .checkpoint/runs/stream-continuation-fixture-2026-10-07/).
        const turnHasReceipt = observed.some(
          (record) => !record.failed && record.status !== null && record.status < 400,
        );
        if (!retryUsed && !turnHasReceipt) {
          retryUsed = true;
          ledger.startRetry(scenario.id, turnId);
          const retryFrom = requests.length;
          await sendOnce();
          await Promise.all(responses.slice(retryFrom));
          observed.push(...requests.slice(retryFrom));
        }
        // Recompute after any retry so the oracle sees the turn's final
        // receipt state, not the pre-retry snapshot.
        const finalReceiptSeen = observed.some(
          (record) => !record.failed && record.status !== null && record.status < 400,
        );
        activeTurn = null;
        const priorBodies: (string | null)[] = [];
        for (const record of observed) {
          const requestFailed = record.failed || (record.status !== null && record.status >= 400);
          let kind: string;
          if (requestFailed && turnHasReceipt) {
            // Abort telemetry is preserved in the evidence; the request is
            // classified by body identity and never as a shopper failure.
            kind =
              record.body !== null && priorBodies.includes(record.body) ? 'retry' : 'continuation';
          } else {
            kind = classifyRequestKind(record, priorBodies);
          }
          ledger.recordRequest(
            scenario.id,
            turnId,
            kind,
            `${scenario.id}:${turnId}:${priorBodies.length}`,
          );
          priorBodies.push(record.body);
        }
        for (const action of turn.uiActions ?? []) await applyAction(workspace, action);
        const notice =
          (await panel.locator('.connected-system-notice').count()) > previousNotices
            ? await panel.locator('.connected-system-notice').last().textContent()
            : null;
        for (const assertion of turn.expects) {
          const status = notice ? 'blocked' : await observe(workspace, assertion, previousSaved);
          ledger.recordAssertion(
            scenario.id,
            `${turnId}:${assertion}`,
            status,
            notice ?? `${assertion}: ${status}`,
          );
        }
        // Mechanical retrieval-consistency check: every visible discover card
        // identity must come from the turn's retrieved objectID set.
        const turnEvidence = evidenceResponses
          .slice(evidenceFrom)
          .filter((record) => record.body !== null);
        if (turn.expects.includes('discovery-results')) {
          const visibleIds = await workspace
            .locator('.pw-discover .pw-product[data-product-id]')
            .evaluateAll((nodes) => [
              ...new Set(nodes.map((node) => node.getAttribute('data-product-id')).filter(Boolean)),
            ]);
          const retrievedIds = new Set(
            turnEvidence.flatMap((record) => {
              const body = record.body as { records?: { objectID?: string }[] };
              return (body.records ?? []).map((item) => item.objectID).filter(Boolean);
            }),
          );
          const status =
            turnEvidence.length === 0
              ? 'unknown'
              : visibleIds.every((id) => retrievedIds.has(id))
                ? 'pass'
                : 'fail';
          ledger.recordAssertion(
            scenario.id,
            `${turnId}:retrieval-objectids-cover-cards`,
            status,
            `${visibleIds.length} visible cards; ${retrievedIds.size} retrieved objectIDs from ${turnEvidence.length} evidence responses`,
          );
        }
        if (turn.expects.includes('stopping-respected') && preStopDiscoverCount !== null) {
          await chooseView(workspace, 'Discover');
          const postStopCount = await workspace.locator('.pw-discover .pw-product').count();
          ledger.recordAssertion(
            scenario.id,
            `${turnId}:discover-cards-not-expanded`,
            postStopCount <= preStopDiscoverCount ? 'pass' : 'fail',
            `discover cards ${preStopDiscoverCount} before the stop request, ${postStopCount} after`,
          );
        }
        await testInfo.attach(`${scenario.id}-turn-${turnId}.png`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        // Completion oracle: HTTP 200 alone is not success. The turn completes
        // only with a receipt, the exact latest transcript assistant ID inside
        // the app's new completed-ID delta, and a newly rendered rail message.
        const replyText = await panel
          .locator('.connected-assistant-message')
          .last()
          .textContent()
          .catch(() => null);
        const signalsAfter = await readCompletionSignals(page);
        const railCountAfter = await panel.locator('.connected-assistant-message').count();
        const latestTranscriptAssistantId =
          signalsAfter.transcriptIds[signalsAfter.transcriptIds.length - 1] ?? null;
        const completion = evaluateTurnCompletion({
          receiptSeen: finalReceiptSeen,
          replyText,
          previousReplyText,
          latestTranscriptAssistantId,
          completedAssistantIds: signalsAfter.completedIds,
          previousCompletedAssistantIds: signalsBefore.completedIds,
          newAssistantMessageRendered: railCountAfter > railCountBefore,
        });
        previousReplyText = completion === 'completed' ? replyText : previousReplyText;
        ledger.recordAssertion(
          scenario.id,
          `${turnId}:turn-completion`,
          completion === 'completed' ? 'pass' : 'fail',
          `oracle: ${completion}`,
        );
        mkdirSync(receiptDir, { recursive: true });
        writeFileSync(
          path.join(receiptDir, `turn-${scenario.id}-${turnId}.json`),
          JSON.stringify(
            {
              scenario: scenario.id,
              turnId,
              shopperText: variantFor(scenario.id, index) ?? turn.text,
              completion,
              replyText,
              requests: observed,
              assertions: ledger.assertions(scenario.id),
              firstFailure: ledger.firstFailure(scenario.id),
            },
            null,
            2,
          ),
        );
        evidence.push({
          scenario: scenario.id,
          turnId,
          shopperText: variantFor(scenario.id, index) ?? turn.text,
          evidenceResponses: turnEvidence,
          visibleReply: await panel
            .locator('.connected-assistant-message')
            .last()
            .textContent()
            .catch(() => null),
          requests: observed,
          assertions: ledger.assertions(scenario.id),
          firstFailure: ledger.firstFailure(scenario.id),
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await testInfo.attach(`${scenario.id}-first-error.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      evidence.push({ scenario: scenario.id, turnId: lastTurn, error: detail, requests });
      // Durable receipt for the failing turn: written even when the turn
      // crashed before the normal per-turn write.
      writeFileSync(
        path.join(receiptDir, `turn-${scenario.id}-${lastTurn ?? 'unknown'}-error.json`),
        JSON.stringify({ scenario: scenario.id, turnId: lastTurn, error: detail, requests }, null, 2),
      );
      if (detail.startsWith('Scenario failure:'))
        ledger.recordAssertion(scenario.id, 'ui-action', 'fail', detail);
      else ledger.stopForHarnessDefect(detail);
    } finally {
      await page.close();
    }
  }
  await testInfo.attach('campaign-ledger.json', {
    body: JSON.stringify(
      {
        totals: ledger.totals(),
        scenarios: Object.fromEntries(
          manifest.scenarios.map((scenario) => [
            scenario.id,
            {
              verdict: ledger.verdict(scenario.id),
              assertions: ledger.assertions(scenario.id),
              firstFailure: ledger.firstFailure(scenario.id),
            },
          ]),
        ),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await testInfo.attach('turn-evidence.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  expect(ledger.stopped, ledger.stopReason ?? '').toBe(false);
  expect(
    manifest.scenarios.every((scenario) => ledger.verdict(scenario.id) === 'pass'),
    'Unknown, blocked and failed assertions are not passes.',
  ).toBe(true);
});
