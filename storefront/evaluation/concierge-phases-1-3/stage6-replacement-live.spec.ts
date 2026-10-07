// Stage 6 CONNECTED replacement slice - real headless browser, real published
// agent, real read-only catalogue. Declared in scenario-manifest.json under
// connectedSlices as stage6-replacement; launches ONLY when explicitly gated.
// Fixture and local-stub evidence live in tests/e2e/concierge-looks.spec.ts and
// are never mixed with this file's live evidence.
//
// Gates (all required; without them the spec skips with zero network calls):
//   JTV_RUN_STAGE6_CONNECTED=1
//   JTV_STAGE6_MAX_COMPLETION_REQUESTS  (positive integer; slice stop budget)
// The app must already be running locally. Halt on first failure: the ledger
// stops the campaign, remaining turns stay unexecuted, receipts are preserved.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import manifest from './scenario-manifest.json' with { type: 'json' };
import { CampaignLedger, classifyRequestKind, evaluateTurnCompletion } from './accounting.mjs';

const connected = process.env.JTV_RUN_STAGE6_CONNECTED === '1';
const requestedBudget = Number(process.env.JTV_STAGE6_MAX_COMPLETION_REQUESTS);
const budgetReady = Number.isSafeInteger(requestedBudget) && requestedBudget > 0;
const sliceBudgetCap = 60;
const budgetWithinCap = budgetReady && requestedBudget <= sliceBudgetCap;

type Turn = { text: string; expects: string[]; uiActions?: { kind: string; count: number }[] };
type RequestRecord = { url: string; body: string | null; status: number | null; failed: boolean };

// Reads the app's own completion receipt set (jtv-concierge-completed-*) and
// the persisted chat transcript's assistant IDs from session storage. The
// transcript scan is generic over the persistence key format: any key whose
// JSON parses to a message list with assistant entries contributes IDs.
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

// Shopper turns are natural, varied, and never name a specific catalogue SKU;
// the agent, not the test, selects products. No assertion reads generated
// reply prose; assertions cover UI structure, counts, arithmetic and notices.
const turns: Turn[] = [
  {
    text: 'I am shopping for my partner and want a white gold necklace to anchor a complete look.',
    expects: ['scoped-preferences', 'mission-recorded'],
  },
  {
    text: 'Show me some necklace options so I can save one I like as the anchor.',
    expects: ['discovery-results'],
    uiActions: [{ kind: 'save-first', count: 1 }],
  },
  {
    text: 'Now build a complete look around that saved necklace.',
    expects: ['look-candidates', 'anchor-retained', 'combination-state'],
    uiActions: [{ kind: 'combination-add-first', count: 2 }],
  },
  {
    text: 'Replace the companion piece with something that has no yellow gold anywhere on it.',
    expects: ['component-replacement', 'anchor-retained', 'yellow-gold-exclusion-upheld'],
  },
  {
    text: 'Does this look include every piece shown? Verify the contents before calling it complete.',
    expects: ['unknown-set-contents', 'no-complete-look-claim'],
  },
  {
    text: 'Show me the exact total for the pieces you are certain about.',
    expects: ['exact-cents-subtotal'],
  },
  {
    text: 'If any piece conflicts with my no-yellow-gold requirement, withhold it instead of showing it.',
    expects: ['guardrail-withholding-disclosed'],
  },
  {
    text: 'This look works. Keep it and stop showing me alternatives.',
    expects: ['selection-retained', 'stopping-respected'],
  },
];

async function openConcierge(page: Page) {
  await page.goto('/category/necklaces');
  await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toBeVisible();
  return panel;
}

test('stage 6 connected replacement slice', async ({ browser }, testInfo) => {
  test.skip(!connected, 'Connected slice is explicitly gated (JTV_RUN_STAGE6_CONNECTED=1).');
  test.skip(!budgetReady, 'Set JTV_STAGE6_MAX_COMPLETION_REQUESTS explicitly.');
  test.skip(
    !budgetWithinCap,
    `Slice budget must not exceed the declared ${sliceBudgetCap}-request reservation.`,
  );
  // Receipts go to durable .checkpoint/runs/, never the shared cleanable
  // test-results dir: a parallel worker's clean wiped the first attempt's
  // evidence before classification.
  const runDir = path.resolve(
    process.cwd(),
    `../.checkpoint/runs/stage6-replacement-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  mkdirSync(runDir, { recursive: true });
  const ledger = new CampaignLedger({ maximumCompletionRequests: requestedBudget });
  const evidence: unknown[] = [];
  const screenshots: string[] = [];
  let previousReplyText: string | null = null;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let activeTurn: string | null = null;
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
  const slice = (manifest.connectedSlices ?? []).find((item) => item.id === 'stage6-replacement');
  const declaredTurnCount = slice?.turns ?? turns.length;

  try {
    const panel = await openConcierge(page);
    const workspace = panel.getByRole('region', { name: 'Shopping choices' });
    for (const [index, turn] of turns.entries()) {
      if (ledger.stopped) break;
      const turnId = `${index + 1}`;
      const previousSaved = await panel
        .getByRole('navigation', { name: 'Product views' })
        .getByRole('button', { name: /^Saved(?: \(\d+\))?$/ })
        .textContent()
        .then((label) => Number(label?.match(/\((\d+)\)/)?.[1] ?? 0))
        .catch(() => 0);
      // Captured BEFORE the send so the oracle can compute true deltas.
      const signalsBefore = await readCompletionSignals(page);
      const railCountBefore = await panel.locator('.connected-assistant-message').count();
      ledger.startTurn('stage6-replacement', turnId);
      activeTurn = turnId;
      const from = requests.length;
      const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
      await input.fill(turn.text);
      await panel.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(input).toBeDisabled();
      await expect(input).toBeEnabled({ timeout: 180_000 });
      await Promise.all(responses.slice(from));
      activeTurn = null;
      const observed = requests.slice(from);
      const turnHasReceipt = observed.some(
        (record) => !record.failed && record.status !== null && record.status < 400,
      );
      // Same artifact rule as the Stage 7 runner: an aborted stream with a
      // completion receipt and a visible reply is not a shopper failure.
      const priorBodies: (string | null)[] = [];
      for (const record of observed) {
        const requestFailed =
          record.failed || (record.status !== null && record.status >= 400);
        let kind: string;
        if (requestFailed && turnHasReceipt) {
          kind =
            record.body !== null && priorBodies.includes(record.body)
              ? 'retry'
              : 'continuation';
        } else {
          kind = classifyRequestKind(record, priorBodies);
        }
        ledger.recordRequest(
          'stage6-replacement',
          turnId,
          kind,
          `stage6-replacement:${turnId}:${priorBodies.length}`,
        );
        priorBodies.push(record.body);
      }
      for (const action of turn.uiActions ?? []) {
        if (action.kind === 'save-first') {
          await workspace.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: /^Discover/ }).click();
          const ids = await workspace
            .locator('.pw-product[data-product-id]')
            .evaluateAll((nodes) => [
              ...new Set(nodes.map((node) => node.getAttribute('data-product-id')).filter(Boolean)),
            ]);
          await workspace
            .locator(`.pw-product[data-product-id="${ids[0]}"]`)
            .first()
            .getByRole('button', { name: 'Save', exact: true })
            .click({ timeout: 15_000 });
        }
        if (action.kind === 'combination-add-first') {
          await workspace.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: /^Saved/ }).click();
          const cards = workspace.locator('.pw-saved .pw-product');
          for (let cardIndex = 0; cardIndex < action.count; cardIndex += 1) {
            await cards
              .nth(cardIndex)
              .getByRole('button', { name: 'Add to combination', exact: true })
              .click({ timeout: 15_000 });
          }
          await workspace.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: /^Combination/ }).click();
        }
      }
      // Mechanical observations only; interpretive expectations stay unknown
      // for independent review of the captured evidence. The completion oracle
      // requires a transport receipt AND the exact latest transcript assistant
      // ID inside the app's new completed-ID delta AND a newly rendered rail
      // message - HTTP 200 plus partial text from a broken stream cannot pass.
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
        receiptSeen: turnHasReceipt,
        replyText,
        previousReplyText,
        latestTranscriptAssistantId,
        completedAssistantIds: signalsAfter.completedIds,
        previousCompletedAssistantIds: signalsBefore.completedIds,
        newAssistantMessageRendered: railCountAfter > railCountBefore,
      });
      previousReplyText = completion === 'completed' ? replyText : previousReplyText;
      ledger.recordAssertion(
        'stage6-replacement',
        `${turnId}:turn-completion`,
        completion === 'completed' ? 'pass' : 'fail',
        `oracle: ${completion}`,
      );
      for (const expectation of turn.expects) {
        // Only discovery and combination state are mechanically checkable here;
        // everything else records unknown for the independent reviewer.
        if (expectation === 'discovery-results') {
          await workspace.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: /^Discover/ }).click();
          const cards = await workspace.locator('.pw-discover .pw-product').count();
          ledger.recordAssertion(
            'stage6-replacement',
            `${turnId}:discovery-results`,
            cards > 0 ? 'pass' : 'fail',
            `${cards} discover cards visible`,
          );
        } else if (expectation === 'combination-state') {
          await workspace.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: /^Combination/ }).click();
          const cards = await workspace.locator('.pw-compare-product[data-product-id]').count();
          ledger.recordAssertion(
            'stage6-replacement',
            `${turnId}:combination-state`,
            cards >= 2 ? 'pass' : 'fail',
            `${cards} combination tiles visible`,
          );
        } else {
          ledger.recordAssertion(
            'stage6-replacement',
            `${turnId}:${expectation}`,
            'unknown',
            'interpretive expectation pending independent review',
          );
        }
      }
      mkdirSync(runDir, { recursive: true });
      const shotPath = path.join(runDir, `turn-${turnId}.png`);
      writeFileSync(shotPath, await page.screenshot());
      screenshots.push(shotPath);
      evidence.push({
        turnId,
        shopperText: turn.text,
        visibleReply: await panel
          .locator('.connected-assistant-message')
          .last()
          .textContent()
          .catch(() => null),
        requests: observed,
        assertions: ledger.assertions('stage6-replacement'),
        firstFailure: ledger.firstFailure('stage6-replacement'),
      });
      // Persist receipts incrementally so a later crash or clean cannot
      // destroy the turns already paid for: per-turn receipt file plus ledger.
      writeFileSync(
        path.join(runDir, `turn-${turnId}.json`),
        JSON.stringify(
          {
            turnId,
            shopperText: turn.text,
            completion,
            replyText,
            oracleInputs: { latestTranscriptAssistantId, completedIdsAfter: signalsAfter.completedIds },
            requests: observed,
            assertions: ledger.assertions('stage6-replacement'),
            firstFailure: ledger.firstFailure('stage6-replacement'),
          },
          null,
          2,
        ),
      );
      writeFileSync(
        path.join(runDir, 'ledger.json'),
        JSON.stringify(
          { totals: ledger.totals(), assertions: ledger.assertions('stage6-replacement'), evidence, screenshots },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ledger.stopForHarnessDefect(detail);
    evidence.push({ error: detail, requests });
  } finally {
    await context.close();
  }
  writeFileSync(
    path.join(runDir, 'ledger.json'),
    JSON.stringify(
      {
        totals: ledger.totals(),
        assertions: ledger.assertions('stage6-replacement'),
        evidence,
        screenshots,
        provenance: {
          agentSnapshot: 'storefront/evidence/agent-2026-10-07T09-00-42-446Z.json',
          instructionsHash:
            '5e6ac74fd64109da02e215209da5e1b1c5a071f05376fa5f94a069de78deee04',
          evidenceLabel: 'local-connected',
        },
      },
      null,
      2,
    ),
  );
  await testInfo.attach('stage6-replacement-ledger.json', {
    body: JSON.stringify({ totals: ledger.totals(), assertions: ledger.assertions('stage6-replacement') }, null, 2),
    contentType: 'application/json',
  });
  expect(ledger.stopped, ledger.stopReason ?? '').toBe(false);
  expect(
    Object.values(ledger.assertions('stage6-replacement')).some((entry) => entry.status === 'fail'),
    'no mechanical assertion may fail',
  ).toBe(false);
  expect(
    ledger.totals().shopperTurns,
    `slice declares ${declaredTurnCount} turns`,
  ).toBeGreaterThan(0);
});
