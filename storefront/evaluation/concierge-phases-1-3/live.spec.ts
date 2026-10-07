import { expect, test, type Page, type Locator } from '@playwright/test';
import manifest from './scenario-manifest.json' with { type: 'json' };
import { CampaignLedger } from './accounting.mjs';

const live = process.env.JTV_RUN_LIVE_CONCIERGE_E2E === '1';
const requestedBudget = Number(process.env.JTV_MAX_COMPLETION_REQUESTS);
const budgetReady = Number.isSafeInteger(requestedBudget) && requestedBudget > 0;

type Action = { kind: 'save-first' | 'compare-first-saved'; count: number };
type Turn = { text: string; expects: string[]; beforeUiActions?: Action[]; uiActions?: Action[] };
type RequestRecord = { url: string; body: string | null; status: number | null; failed: boolean };

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
    .click();
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
        .click();
    }
    return;
  }
  if (action.kind === 'compare-first-saved') {
    await chooseView(workspace, 'Saved');
    const cards = workspace.locator('.pw-saved .pw-product');
    if ((await cards.count()) < action.count)
      throw new Error('Scenario failure: not enough Saved choices to compare.');
    for (let index = 0; index < action.count; index += 1) {
      await cards.nth(index).getByRole('button', { name: 'Compare', exact: true }).click();
    }
    await chooseView(workspace, 'Compare');
    await expect(workspace.locator('.pw-compare-product')).toHaveCount(action.count);
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
  // Interpretive requirements require an independent evidence review. They
  // remain unknown until a reviewer assesses the captured turn and sources.
  return 'unknown';
}

test('Plan 3.1 integrated campaign', async ({ browser }, testInfo) => {
  test.skip(!live, 'Paid connected journeys are opt-in.');
  test.skip(!budgetReady, 'Set an explicit cumulative completion-request budget.');
  const ledger = new CampaignLedger({ maximumCompletionRequests: requestedBudget });
  const evidence: unknown[] = [];
  for (const scenario of manifest.scenarios) {
    if (ledger.stopped) break;
    const page = await browser.newPage();
    let activeTurn: string | null = null;
    let lastTurn: string | null = null;
    const requests: RequestRecord[] = [];
    const responses: Promise<void>[] = [];
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
        for (const action of turn.beforeUiActions ?? []) await applyAction(workspace, action);
        ledger.startTurn(scenario.id, turnId);
        activeTurn = turnId;
        const from = requests.length;
        const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
        await input.fill(turn.text);
        await panel.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(input).toBeDisabled();
        await expect(input).toBeEnabled({ timeout: 120_000 });
        activeTurn = null;
        await Promise.all(responses.slice(from));
        const observed = requests.slice(from);
        if (!observed.length)
          throw new Error(
            'Harness defect: shopper turn produced no observable completion request.',
          );
        for (const [requestIndex, record] of observed.entries()) {
          ledger.recordRequest(
            scenario.id,
            turnId,
            record.failed || (record.status !== null && record.status >= 400)
              ? 'failure'
              : requestIndex
                ? 'continuation'
                : 'completion',
            `${scenario.id}:${turnId}:${requestIndex}`,
          );
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
        await testInfo.attach(`${scenario.id}-turn-${turnId}.png`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        evidence.push({
          scenario: scenario.id,
          turnId,
          shopperText: turn.text,
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
