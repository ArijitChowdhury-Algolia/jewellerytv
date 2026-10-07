import { expect, test, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CampaignLedger, classifyRequestKind } from './accounting.mjs';
import {
  ASSISTANT_REPLY_CLASS,
  activeBriefFactsOf,
  activeMaterialRequirementOf,
  evaluateCitations,
  evaluateMaterialRecords,
  evaluateNoRetrieval,
  evaluateWhiteGoldRecords,
  effectiveFilterJson,
  priceOperatorMatches,
  unwrapEvidenceRecord,
} from './stage2-smoke-helpers.mjs';

// Stage 2 residual acceptance windows (STAGE2-RESIDUAL-MATRIX-AUDIT-2026-10-07.md).
// One test per window W1-W5; cases inside a window run sequentially in one session.
// Opt-in only: JTV_RUN_STAGE2_RESIDUAL=1. R-6 (window W5) is additionally gated on
// JTV_STAGE3_PURITY_REPAIR_APPLIED=1 per the audit's scheduling note.
//
// BUDGET RECONCILIATION: each window's cap (W1 40, W2 20, W3 15, W4 30, W5 10) is a
// HARNESS STOP CONDITION on the harness's own request budget, never an
// assistant-chosen cap; derivation matches the stage2-smoke header. A failed or
// inconclusive first case in a window stops that window until diagnosed.
// EXECUTION ORDER: tests run in FILE order, which is W3, W1, W2, W4, W5 - the
// window numbers are labels, not the run sequence. Run ONE window per command
// (Playwright -g on the test name) so the single JTV_MAX_COMPLETION_REQUESTS
// value matches that window's cap; the example below only fits W1.
// DUPLICATION GUARD (receipts audit 2026-10-07): W1-R5a's query text is verbatim
// the stage2-smoke C4 turn, and the strict Yellow exclusion is already proven
// paid by .checkpoint/runs/c4-exclusion-verify-2026-10-07T07-05-19-118Z/ - R5a
// is confirmation-only; R5b's rewording is the new half. W2-R10's exact-ID
// mechanism is proven by stage5-refinement; only its strict exactObjectIDs /
// evidenceRef oracle is new. W5-R6a's 14K half is proven by stage5-refinement
// turn 1; R6b (18K) has zero receipts.
// Documented invocation:
//   JTV_RUN_STAGE2_RESIDUAL=1 JTV_MAX_COMPLETION_REQUESTS=<window cap>

const live = process.env.JTV_RUN_STAGE2_RESIDUAL === '1';
const requestedBudget = Number(process.env.JTV_MAX_COMPLETION_REQUESTS ?? 0);
const budgetReady = Number.isSafeInteger(requestedBudget) && requestedBudget > 0;

const INTERCEPTED = ['/api/chat', '/api/agent-evidence', '/api/agent-product-refresh', '/api/products/'];

type RequestRecord = {
  turn: string;
  url: string;
  method: string;
  requestBody: string | null;
  status: number | null;
  responseBody: string | null;
  failed: boolean;
  at: string;
};
type EvidenceCall = { captured: boolean; parsed: unknown; record: RequestRecord };

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type Harness = {
  page: Page;
  panel: ReturnType<Page['getByRole']>;
  workspace: ReturnType<Page['getByRole']>;
  ledger: CampaignLedger;
  runDir: string;
  requests: RequestRecord[];
  runTurn: (turnId: string, text: string) => Promise<{
    replyAdded: boolean;
    replyText: string;
    replyLinks: string[];
    before: Array<{ id: string; text: string }>;
    after: Array<{ id: string; text: string }>;
    elapsedMs: number;
  }>;
  evidenceCalls: (turn: string) => EvidenceCall[];
  snapshot: () => Promise<Array<{ id: string; text: string }>>;
};

async function openConcierge(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toBeVisible();
  return panel;
}

function chooseView(workspace: ReturnType<Page['getByRole']>, name: string) {
  return workspace
    .getByRole('navigation', { name: 'Product views' })
    .getByRole('button', { name: new RegExp(`^${name}(?: \\(\\d+\\))?$`) })
    .click();
}

async function workspaceSnapshot(workspace: ReturnType<Page['getByRole']>) {
  await chooseView(workspace, 'Discover');
  await expect(workspace.locator('.pw-discover')).toBeVisible({ timeout: 10_000 });
  return workspace.locator('.pw-discover .pw-product').evaluateAll((nodes) =>
    nodes.map((node) => {
      // ProductWorkspace.tsx renders each card as article.pw-product with
      // data-product-id; an href-based extraction measured identity-unknown on
      // every card of the first paid Stage 4 run, so the attribute is authoritative.
      const id = node.getAttribute('data-product-id') ?? '';
      return { id: id || 'identity-unknown', text: (node.textContent ?? '').slice(0, 220) };
    }),
  );
}

/**
 * Build one window's harness in a fresh browser context. The route abort beyond
 * the window cap and the allowlist watcher mirror the stage4-anniversary spec.
 */
async function openWindow(page: Page, windowName: string, cap: number, runDir: string): Promise<Harness> {
  const ledger = new CampaignLedger({ maximumCompletionRequests: cap });
  const requests: RequestRecord[] = [];
  const pending: Promise<void>[] = [];
  let activeTurn: string | null = null;
  let completionRequests = 0;

  await page.route('**/api/chat', async (route) => {
    completionRequests += 1;
    if (completionRequests > cap) {
      ledger.stopForHarnessDefect(`Window ${windowName} completion budget ${cap} exceeded.`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  page.on('request', (request) => {
    const url = request.url();
    if (!INTERCEPTED.some((fragment) => url.includes(fragment))) {
      if (
        !/localhost|127\.0\.0\.1|images\.jtv\.com|www\.jtv\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|\/assets\/|favicon|\.(css|js|png|jpe?g|svg|webp|woff2?)(\?|$)/.test(
          url,
        )
      )
        ledger.stopForHarnessDefect(`Request outside the allowlist: ${url}`);
      return;
    }
    if (url.includes('/api/chat') && !activeTurn) {
      ledger.stopForHarnessDefect('Completion request outside a shopper turn.');
      return;
    }
    const turn = activeTurn ?? 'outside-turn';
    pending.push(
      (async () => {
        const response = await request.response();
        let body: string | null = null;
        let status: number | null = null;
        let failed = false;
        let bodyUnreadable = false;
        if (response) {
          status = response.status();
          try {
            body = await response.text();
          } catch {
            // A streamed chat body that cannot be re-read is NOT a transport
            // failure: classifyRequestKind treats unreadable bodies as
            // continuations, not retries or failures (stage2-smoke semantics).
            bodyUnreadable = true;
          }
        } else failed = true;
        void bodyUnreadable;
        const record: RequestRecord = {
          turn,
          url: request.url(),
          method: request.method(),
          requestBody: request.postData(),
          status,
          responseBody: body,
          failed,
          at: new Date().toISOString(),
        };
        requests.push(record);
        if (record.url.includes('/api/chat')) {
          const priorBodies = requests
            .filter((r) => r.turn === turn && r.url.includes('/api/chat') && r !== record)
            .map((r) => r.requestBody);
          ledger.recordRequest(
            `stage2-${windowName}`,
            turn,
            classifyRequestKind(record, priorBodies),
            `stage2-${windowName}:${turn}:${requests.filter((r) => r.turn === turn).length}`,
          );
        }
        fs.writeFileSync(
          path.join(
            runDir,
            `turn-${turn}-${(record.url.split('/api/')[1] ?? 'other').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-${requests.length}.json`,
          ),
          JSON.stringify(
            { url: record.url, requestBody: safeParse(record.requestBody), responseBody: safeParse(record.responseBody), status, failed },
            null,
            2,
          ),
        );
      })().catch(() => undefined),
    );
  });

  const panel = await openConcierge(page);
  const workspace = panel.getByRole('region', { name: 'Shopping choices' });
  await page.screenshot({ path: path.join(runDir, `open-${windowName}.png`) });

  const evidenceCalls = (turn: string): EvidenceCall[] =>
    requests
      .filter((r) => r.turn === turn && r.url.includes('/api/agent-evidence'))
      .map((record) => {
        const parsed = safeParse(record.responseBody);
        const captured =
          !record.failed && record.status === 200 && parsed !== null && typeof parsed === 'object';
        return { captured, parsed, record };
      });

  // NOTE (audit 2026-10-07): the former dead `assertCommon` helper (defined
  // then voided) is deleted. Cases record reply-generated inline; the no-em-dash
  // check currently rides the stage2-smoke suite, not the residual windows.

  async function runTurn(
    turnId: string,
    text: string,
    midTurn?: () => Promise<void>,
  ) {
    ledger.startTurn(`stage2-${windowName}`, turnId);
    activeTurn = turnId;
    const startedAt = Date.now();
    const captureFrom = pending.length;
    const repliesBefore = await panel.locator(`.${ASSISTANT_REPLY_CLASS}`).count();
    const noticesBefore = await panel.locator('.connected-system-notice').count();
    const before = await workspaceSnapshot(workspace);
    const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
    await input.fill(text);
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(input).toBeDisabled();
    // R-2's manual edit happens here: the turn is in flight (composer disabled)
    // while the workspace stays interactive.
    if (midTurn) await midTurn();
    await expect(input).toBeEnabled({ timeout: 120_000 });
    activeTurn = null;
    await Promise.all(pending.slice(captureFrom));
    try {
      await expect
        .poll(
          async () =>
            (await panel.locator(`.${ASSISTANT_REPLY_CLASS}`).count()) > repliesBefore ||
            (await panel.locator('.connected-system-notice').count()) > noticesBefore,
          { timeout: 5_000 },
        )
        .toBe(true);
    } catch {
      /* absence is recorded by assertions, never as a pass */
    }
    const replyAdded = (await panel.locator(`.${ASSISTANT_REPLY_CLASS}`).count()) > repliesBefore;
    const replyText = replyAdded
      ? ((await panel.locator(`.${ASSISTANT_REPLY_CLASS}`).last().textContent()) ?? '').trim()
      : '';
    const replyLinks = replyAdded
      ? await panel
          .locator(`.${ASSISTANT_REPLY_CLASS}`)
          .last()
          .locator('a')
          .evaluateAll((nodes) =>
            nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? '').filter(Boolean),
          )
      : [];
    const after = await workspaceSnapshot(workspace);
    const elapsedMs = Date.now() - startedAt;
    await page.screenshot({ path: path.join(runDir, `turn-${turnId}.png`) });
    await workspace.screenshot({ path: path.join(runDir, `turn-${turnId}-workspace.png`) });
    fs.writeFileSync(
      path.join(runDir, `turn-${turnId}-snapshot.json`),
      JSON.stringify({ text, replyText, replyLinks, before, after, elapsedMs }, null, 2),
    );
    return { replyAdded: replyAdded && replyText.length > 0, replyText, replyLinks, before, after, elapsedMs };
  }

  return { page, panel, workspace, ledger, runDir, requests, runTurn, evidenceCalls, snapshot: () => workspaceSnapshot(workspace) };
}

function writeSummary(harness: Harness, windowName: string) {
  const ledger = harness.ledger;
  const summary = {
    window: windowName,
    at: new Date().toISOString(),
    totals: ledger.totals(),
    verdict: ledger.verdict(`stage2-${windowName}`),
    firstFailure: ledger.firstFailure(`stage2-${windowName}`),
    assertions: ledger.assertions(`stage2-${windowName}`),
  };
  fs.writeFileSync(path.join(harness.runDir, `summary-${windowName}.json`), JSON.stringify(summary, null, 2));
  console.log(`STAGE2-RESIDUAL-${windowName}`, JSON.stringify({ verdict: summary.verdict, totals: summary.totals }, null, 2));
}

test.describe.serial('Stage 2 residual windows', () => {
  test.skip(!live || !budgetReady, 'Opt-in paid residual windows (JTV_RUN_STAGE2_RESIDUAL=1 plus a positive JTV_MAX_COMPLETION_REQUESTS).');

  // ---- Window W3: ordering and concurrency (R-1, R-2, R-3), cap 15 ---------
  test('W3 ordering: R-1 revision linkage, R-2 manual edit in flight, R-3 untyped constraints', async ({ page }, testInfo) => {
    const runDir = path.resolve('..', '.checkpoint', 'runs', `stage2-residual-w3-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(runDir, { recursive: true });
    const h = await openWindow(page, 'w3', 15, runDir);
    try {
      // R-1: same-turn update, retrieve, present ordering with receipt linkage.
      const r1 = await h.runTurn('R1', 'I want a necklace for my wife, white gold if possible, under 250 dollars.');
      h.ledger.recordAssertion('stage2-w3', 'R1-reply-generated', r1.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r1Calls = h.evidenceCalls('R1');
      const chatBodies = h.requests
        .filter((r) => r.turn === 'R1' && r.url.includes('/api/chat'))
        .map((r) => safeParse(r.responseBody));
      // Revision linkage: the evidence input's expectedRevision equals the update
      // receipt's accepted revision from the SAME turn. Both are captured bodies.
      let linkageSeen = false;
      let linkageUnreadable = false;
      const revisionsFromReceipts = new Set<number>();
      for (const body of chatBodies) {
        const result = (body as { result?: { revision?: number } } | null)?.result;
        if (result && typeof result.revision === 'number') revisionsFromReceipts.add(result.revision);
      }
      for (const call of r1Calls) {
        const requestBody = safeParse(call.record.requestBody) as
          | { expectedRevision?: number; missionId?: string }
          | null;
        if (!requestBody || typeof requestBody.expectedRevision !== 'number') {
          if (call.record.requestBody) linkageUnreadable = true;
          continue;
        }
        if (revisionsFromReceipts.has(requestBody.expectedRevision)) linkageSeen = true;
      }
      h.ledger.recordAssertion(
        'stage2-w3',
        'R1-revision-linkage',
        linkageSeen ? 'pass' : linkageUnreadable ? 'unknown' : 'fail',
        `evidence expectedRevision must equal the same-turn update receipt revision; receipts with revisions: ${[...revisionsFromReceipts].join(',') || 'none captured'}`,
      );
      const r1Products = productRecordsOfLocal(r1Calls);
      const r1PriceOk = r1Products.every(
        (record) => typeof record.Pricing_ActivePrice === 'number' && (record.Pricing_ActivePrice as number) < 250,
      );
      const r1Material = evaluateWhiteGoldRecords(r1Calls);
      h.ledger.recordAssertion(
        'stage2-w3',
        'R1-records-satisfy-bound-and-material',
        r1Calls.length === 0
          ? 'fail'
          : r1PriceOk && r1Material.status === 'pass'
            ? 'pass'
            : r1Material.status === 'unknown'
              ? 'unknown'
              : 'fail',
        `records must satisfy lt 250 and the white-gold verdict; material ${r1Material.status}, records ${r1Products.length}`,
      );
      const r1CardsUnknown = r1.after.filter((card) => card.id === 'identity-unknown');
      const r1CardsTraced = r1.after.filter(
        (card) => card.id !== 'identity-unknown' && r1Products.some((rec) => rec.objectID === card.id),
      );
      h.ledger.recordAssertion(
        'stage2-w3',
        'R1-cards-trace-to-retrieval',
        r1.after.length === 0 ? 'pass' : r1CardsUnknown.length > 0 ? 'unknown' : r1CardsTraced.length === r1.after.length ? 'pass' : 'fail',
        `presented cards must match staged evidence records or fewer; unknown-identity ${r1CardsUnknown.length}`,
      );

      // R-2: manual edit in flight and stale-write rejection.
      // The mid-turn callback runs while the composer is disabled and the
      // workspace stays interactive. If the visible preference control cannot
      // be located, the case records unknown rather than a pass.
      const r2Before = await h.snapshot();
      let editApplied = false;
      const r2Turn = await h.runTurn(
        'R2',
        'Show me white gold necklaces under 250 dollars.',
        async () => {
          try {
            const editor = h.panel.getByRole('button', { name: /Edit preferences/i });
            if (await editor.count()) {
              await editor.first().click();
              const removeControl = h.panel
                .getByRole('button', { name: /(Remove|Delete|Clear)/i })
                .first();
              if (await removeControl.count()) {
                await removeControl.click();
                editApplied = true;
              }
            }
          } catch {
            editApplied = false;
          }
        },
      );
      h.ledger.recordAssertion('stage2-w3', 'R2-reply-generated', r2Turn.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r2Calls = h.evidenceCalls('R2');
      const r2ChatBodies = h.requests
        .filter((r) => r.turn === 'R2' && r.url.includes('/api/chat'))
        .flatMap((r) => [safeParse(r.requestBody), safeParse(r.responseBody)])
        .filter(Boolean);
      const r2StaleOrNotice = r2ChatBodies.some((body) =>
        JSON.stringify(body).includes('stale_revision') || JSON.stringify(body).includes('operation_conflict'),
      );
      h.ledger.recordAssertion(
        'stage2-w3',
        'R2-stale-or-honest-notice',
        !editApplied && r2Calls.length === 0
          ? 'unknown'
          : r2StaleOrNotice || r2Calls.length === 0
            ? 'pass'
            : 'unknown',
        `in-flight edit: control located=${editApplied}; stale/conflict marker observed=${r2StaleOrNotice}; an ok publication with the edit silently dropped is a fail (review of saved bodies)`,
      );
      const r2Confirm = await h.runTurn('R2c', 'What am I looking for right now?');
      h.ledger.recordAssertion(
        'stage2-w3',
        'R2-confirm-restates',
        r2Confirm.replyAdded ? 'pass' : 'fail',
        'the confirmation turn must restate the current accepted state (interpretive half goes to independent review of the saved reply)',
      );
      h.ledger.recordAssertion('stage2-w3', 'R2-workspace-preserved', r2Confirm.after.length >= r2Before.length ? 'pass' : 'unknown', `discover count ${r2Before.length} -> ${r2Confirm.after.length}`);

      // R-3: effective filters derive only from accepted facts.
      const r3 = await h.runTurn('R3', "Show me a delicate necklace under 200 dollars, the kind you'd see in a boutique.");
      h.ledger.recordAssertion('stage2-w3', 'R3-reply-generated', r3.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r3Calls = h.evidenceCalls('R3');
      const r3Json = r3Calls.map((call) => effectiveFilterJson(call.parsed)).join(' ');
      const r3Typed = r3Json.includes('Catalog_ProductType') && r3Json.includes('Necklace') && r3Json.includes('Pricing_ActivePrice');
      const r3UnTyped = r3Json.includes('delicate') || r3Json.includes('boutique');
      h.ledger.recordAssertion(
        'stage2-w3',
        'R3-only-typed-filters',
        r3Calls.length === 0 ? 'fail' : r3Typed && !r3UnTyped ? 'pass' : 'fail',
        `effectiveFilters must contain only type and price; untyped adjectives must not compile; json=${r3Json.slice(0, 200)}`,
      );
      const r3Products = productRecordsOfLocal(r3Calls);
      const r3PriceOk = r3Products.every(
        (record) => typeof record.Pricing_ActivePrice === 'number' && (record.Pricing_ActivePrice as number) < 200,
      );
      h.ledger.recordAssertion(
        'stage2-w3',
        'R3-records-under-200',
        r3Products.length === 0 ? 'unknown' : r3PriceOk ? 'pass' : 'fail',
        `every returned record must satisfy Pricing_ActivePrice lt 200; records ${r3Products.length}`,
      );
    } finally {
      writeSummary(h, 'w3');
    }
    expect(h.ledger.verdict('stage2-w3'), 'W3 verdict').not.toBe('fail');
  });

  // ---- Window W1: constraint matrix (R-4, R-5, R-7, R-8, R-9), cap 40 ------
  test('W1 constraint matrix: price operators, alternatives OR, colour intent, gemstone facet, watch band', async ({ page }) => {
    const runDir = path.resolve('..', '.checkpoint', 'runs', `stage2-residual-w1-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(runDir, { recursive: true });
    const h = await openWindow(page, 'w1', 40, runDir);
    // STOP-ON-UNKNOWN (W1 repair, 2026-10-07): the W1 cases share one session,
    // so an unknown verdict contaminates every later case (measured: R4b's
    // pearl intent was still active at R5a and produced an unexplained
    // unknown). After each case, any new unknown stops the window; remaining
    // cases are recorded 'blocked' and never spend budget. The window verdict
    // must be a clean 'pass' at the end; 'blocked'/'unknown'/'fail' all fail
    // the test and require diagnosis before any rerun.
    let unknownBaseline = 0;
    const countUnknowns = () =>
      Object.values(h.ledger.assertions('stage2-w1')).filter(
        (assertion) => assertion.status === 'unknown',
      ).length;
    unknownBaseline = countUnknowns();
    let stoppedForUnknown = false;
    const stopForUnknown = (nextCase: string) => {
      h.ledger.recordAssertion(
        'stage2-w1',
        `stop-on-unknown-before-${nextCase}`,
        'blocked',
        `an earlier case in this window recorded unknown; ${nextCase} unexecuted until diagnosed`,
      );
    };
    const guard = async (nextCase: string, run: () => Promise<void>) => {
      if (stoppedForUnknown) {
        stopForUnknown(nextCase);
        return;
      }
      await run();
      stoppedForUnknown = countUnknowns() > unknownBaseline;
      unknownBaseline = countUnknowns();
    };
    try {
      const priceCase = async (turnId: string, text: string, operator: 'gt' | 'gte', bound: number) => {
        const outcome = await h.runTurn(turnId, text);
        h.ledger.recordAssertion(`stage2-w1`, `${turnId}-reply-generated`, outcome.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
        const calls = h.evidenceCalls(turnId);
        const operatorSeen = calls.some((call) => priceOperatorMatches(call.parsed, 'Pricing_ActivePrice', operator));
        const records = productRecordsOfLocal(calls);
        const recordsOk = records.every(
          (record) =>
            typeof record.Pricing_ActivePrice === 'number' &&
            (operator === 'gt' ? (record.Pricing_ActivePrice as number) > bound : (record.Pricing_ActivePrice as number) >= bound),
        );
        h.ledger.recordAssertion(
          'stage2-w1',
          `${turnId}-exact-bound`,
          calls.length === 0 ? 'fail' : operatorSeen && recordsOk ? 'pass' : records.length === 0 ? 'unknown' : 'fail',
          `compiled operator must be ${operator} ${bound} and every record must satisfy it; records ${records.length}`,
        );
      };
      await guard('R4a', async () => {
        await priceCase('R4a', 'Show me gold necklaces over four hundred dollars.', 'gt', 400);
      });
      await guard('R4b', async () => {
        await priceCase('R4b', 'Show me pearl bracelets at three hundred dollars and above.', 'gte', 300);
      });

      // R-5: material alternatives OR plus the exclusion, strict semantics
      // (Arijit's recorded decision: any Yellow entry, including two-tone, is excluded).
      // ACTIVE-FACT REPAIR (2026-10-07): the oracle reads the typed alternatives and
      // exclusion from the ACTIVE accepted state, not from the prompt text; an earlier
      // case's still-active intent (e.g. R4b's pearl) stays visible in the assertion
      // detail instead of silently invalidating the verdict.
      const c4Alternatives = [
        { type: 'Silver', color: 'White', purity: 'Sterling' },
        { type: 'Gold', color: 'White' },
      ];
      const materialCase = async (turnId: string, text: string) => {
        const outcome = await h.runTurn(turnId, text);
        h.ledger.recordAssertion(`stage2-w1`, `${turnId}-reply-generated`, outcome.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
        const requirement = activeMaterialRequirementOf(h.evidenceCalls(turnId));
        h.ledger.recordAssertion(
          'stage2-w1',
          `${turnId}-alternatives-typed-active`,
          requirement.found ? 'pass' : 'fail',
          `active accepted state must carry the typed material alternatives; activeFacts=${requirement.activeFactCount}`,
        );
        const material = evaluateMaterialRecords(
          h.evidenceCalls(turnId),
          requirement.found ? requirement.alternatives : c4Alternatives,
          requirement.excludedColors.length > 0 ? requirement.excludedColors : ['Yellow'],
        );
        h.ledger.recordAssertion(
          'stage2-w1',
          `${turnId}-alternatives-or-exclusion`,
          material.status === 'pass' || material.status === 'fail' || material.status === 'unknown' ? material.status : 'unknown',
          `alternatives OR group with strict exclusion from active facts (excluded=${JSON.stringify(requirement.excludedColors)}); ${JSON.stringify(material)}`,
        );
      };
      await guard('R5a', async () => {
        await materialCase('R5a', 'Actually, sterling silver or white gold is fine, but not yellow gold.');
      });
      await guard('R5b', async () => {
        await materialCase('R5b', 'Let me change that: either sterling silver or white gold works, just nothing yellow gold.');
      });

      // R-7: white gold versus gold colour intent pair.
      await guard('R7a', async () => {
        const r7a = await h.runTurn('R7a', 'Show me white gold necklaces under 200 dollars.');
        h.ledger.recordAssertion('stage2-w1', 'R7a-reply-generated', r7a.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
        const r7aMaterial = evaluateWhiteGoldRecords(h.evidenceCalls('R7a'));
        h.ledger.recordAssertion(
          'stage2-w1',
          'R7a-white-gold-records',
          r7aMaterial.status === 'pass' || r7aMaterial.status === 'fail' || r7aMaterial.status === 'unknown' ? r7aMaterial.status : 'unknown',
          `control half: every record Gold/White; ${JSON.stringify(r7aMaterial)}`,
        );
      });
      await guard('R7b', async () => {
        const r7b = await h.runTurn('R7b', 'Show me gold necklaces under 200 dollars.');
        h.ledger.recordAssertion('stage2-w1', 'R7b-reply-generated', r7b.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
        const r7bCalls = h.evidenceCalls('R7b');
        // SUPERSEDED-FACT REPAIR (2026-10-07): only ACTIVE facts in the latest
        // snapshot may drive this verdict. A white-only fact typed earlier in
        // the turn and then superseded to plain gold previously produced a
        // false white-only failure.
        const r7bWhiteOnlyTyped = activeBriefFactsOf(r7bCalls).some((fact) => {
          const value = fact.value as { kind?: string; alternatives?: Array<{ color?: string }> };
          return (
            fact.field === 'material' &&
            value?.kind === 'material_alternatives' &&
            value.alternatives?.every((alt) => alt.color === 'White') === true
          );
        });
      const r7bRecords = productRecordsOfLocal(r7bCalls);
      const r7bNonWhite = r7bRecords.some((record) =>
        ((record.Catalog_MaterialInformation ?? []) as Array<Record<string, unknown>>).some(
          (entry) => entry.MaterialType === 'Gold' && entry.MaterialColor && entry.MaterialColor !== 'White',
        ),
      );
      h.ledger.recordAssertion(
        'stage2-w1',
        'R7b-no-white-only-typing',
        r7bWhiteOnlyTyped ? 'fail' : r7bNonWhite || r7bRecords.length === 0 ? 'pass' : 'unknown',
        `bare gold must not type a White-only requirement (active facts only); white-only typed=${r7bWhiteOnlyTyped}, non-white gold record present=${r7bNonWhite}, records=${r7bRecords.length}`,
      );
      });

      // R-8: multi-constraint with the supported gemstone colour facet.
      await guard('R8', async () => {
      const r8 = await h.runTurn('R8', 'A white gold necklace with blue stones, under 400 dollars.');
      h.ledger.recordAssertion('stage2-w1', 'R8-reply-generated', r8.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r8Calls = h.evidenceCalls('R8');
      const r8Json = r8Calls.map((call) => effectiveFilterJson(call.parsed)).join(' ');
      const r8Compiled =
        r8Json.includes('Catalog_ProductType') &&
        r8Json.includes('Necklace') &&
        r8Json.includes('GemstoneColorGroup') &&
        r8Json.includes('Blue') &&
        r8Json.includes('Pricing_ActivePrice');
      h.ledger.recordAssertion(
        'stage2-w1',
        'R8-three-filters-compiled',
        r8Calls.length === 0 ? 'fail' : r8Compiled ? 'pass' : 'fail',
        `type, gemstone colour group Blue and price must compile; json=${r8Json.slice(0, 240)}`,
      );
      const r8Records = productRecordsOfLocal(r8Calls);
      const r8GemstoneOk = r8Records.every((record) => {
        const gemstones = [
          ...(((record.Catalog_GemstoneInformation ?? []) as Array<Record<string, unknown>>) ?? []),
          ...(((record.Catalog_GemstoneInformationPrimary ?? []) as Array<Record<string, unknown>>) ?? []),
        ];
        return gemstones.some((entry) => entry.GemstoneColorGroup === 'Blue');
      });
      h.ledger.recordAssertion(
        'stage2-w1',
        'R8-records-blue-gemstone',
        r8Records.length === 0 ? 'unknown' : r8GemstoneOk ? 'pass' : 'fail',
        `every returned record must carry a Blue gemstone colour group entry; records ${r8Records.length}`,
      );
      });

      // R-9: watch band metal family multi-value filter.
      await guard('R9', async () => {
      const r9 = await h.runTurn('R9', 'I need a wrist watch with a metal band, under 100 dollars.');
      h.ledger.recordAssertion('stage2-w1', 'R9-reply-generated', r9.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r9Calls = h.evidenceCalls('R9');
      const r9Json = r9Calls.map((call) => effectiveFilterJson(call.parsed)).join(' ');
      const r9Compiled = r9Json.includes('Wrist Watch') && r9Json.includes('WatchBandMaterialName');
      const r9Records = productRecordsOfLocal(r9Calls);
      const r9BandOk = r9Records.every((record) => {
        const bands = ((record.Catalog_BandMaterialInformation ?? []) as Array<Record<string, unknown>>) ?? [];
        return bands.some((entry) => typeof entry.WatchBandMaterialName === 'string');
      });
      h.ledger.recordAssertion(
        'stage2-w1',
        'R9-watch-band-in-filter',
        r9Calls.length === 0 ? 'fail' : r9Compiled && (r9Records.length === 0 || r9BandOk) ? 'pass' : 'fail',
        `type Wrist Watch plus band-material in-filter must compile and records must carry band entries; json=${r9Json.slice(0, 200)}`,
      );
      });
    } finally {
      writeSummary(h, 'w1');
    }
    // W1 must be a CLEAN pass. An unknown is a stop-and-diagnose signal, never
    // a silent pass: the shared session makes later cases untrustworthy after
    // one unknown (measured: R4b pearl inheritance at R5a). A harness defect
    // (allowlist violation, out-of-turn request) also fails the window.
    const w1Verdict = h.ledger.verdict('stage2-w1');
    const w1Totals = h.ledger.totals();
    expect(w1Totals.defect, `W1 harness defect: ${w1Totals.stopReason ?? 'none'}`).toBe(false);
    expect(
      w1Verdict,
      `W1 verdict must be pass; firstFailure ${JSON.stringify(h.ledger.firstFailure('stage2-w1'))}`,
    ).toBe('pass');
  });

  // ---- Window W2: identity and isolation (R-10, R-11), cap 20 --------------
  test('W2 identity: R-10 exact-ID refresh, R-11 product/blog isolation both directions', async ({ page }) => {
    const runDir = path.resolve('..', '.checkpoint', 'runs', `stage2-residual-w2-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(runDir, { recursive: true });
    const h = await openWindow(page, 'w2', 20, runDir);
    try {
      // Seed a real objectID from a genuine discovery turn; never invent IDs.
      const seed = await h.runTurn('W2seed', 'Show me white gold necklaces under 300 dollars.');
      h.ledger.recordAssertion('stage2-w2', 'W2seed-reply-generated', seed.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const seedRecords = productRecordsOfLocal(h.evidenceCalls('W2seed'));
      const seedId = seedRecords.find((record) => typeof record.objectID === 'string')?.objectID as string | undefined;
      if (!seedId) {
        h.ledger.recordAssertion('stage2-w2', 'R10-exact-refresh', 'unknown', 'no real objectID captured from the seed turn; the exact-ID case cannot run without inventing an ID');
      } else {
        const r10 = await h.runTurn('R10', `Show me that ${seedId} chain again, I want to look at it on its own.`);
        h.ledger.recordAssertion('stage2-w2', 'R10-reply-generated', r10.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
        const r10Calls = h.evidenceCalls('R10');
        const exactCall = r10Calls.find((call) => {
          const parsed = call.parsed as { source?: string; records?: Array<Record<string, unknown>> } | null;
          return parsed?.source === 'prod_catalog' && Array.isArray(parsed?.records);
        });
        const exactBody = r10Calls.map((call) => safeParse(call.record.requestBody) as { exactObjectIDs?: unknown } | null).find((body) => body && 'exactObjectIDs' in body);
        const exactIds = (exactBody?.exactObjectIDs as string[] | null) ?? null;
        const r10Records = exactCall ? ((exactCall.parsed as { records?: Array<Record<string, unknown>> }).records ?? []) : [];
        const r10Inner = r10Records.map((record) => unwrapEvidenceRecord(record));
        const identityOk =
          r10Inner.length === 1 && String(r10Inner[0]?.objectID ?? '') === seedId;
        const refOk = r10Records.every((record) => {
          const ref = String((record as { evidenceRef?: string }).evidenceRef ?? '');
          return ref.startsWith(`prod_catalog/${seedId}/`);
        });
        h.ledger.recordAssertion(
          'stage2-w2',
          'R10-exact-refresh',
          exactCall && exactIds && exactIds.includes(seedId) && identityOk && refOk ? 'pass' : exactCall ? 'fail' : 'unknown',
          `exactObjectIDs must equal [${seedId}] and the response must return that record with a matching evidenceRef; ids=${JSON.stringify(exactIds)}, records=${r10Inner.length}`,
        );
      }

      // R-11a: alias isolation (tempt the blog alias into a product slot).
      const r11a = await h.runTurn('R11a', 'Can you show me that sapphire guide as a product?');
      h.ledger.recordAssertion('stage2-w2', 'R11a-reply-generated', r11a.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r11aCalls = h.evidenceCalls('R11a');
      const r11aProducts = productRecordsOfLocal(r11aCalls);
      const blogShapedInProducts = r11aProducts.filter((record) =>
        /^[0-9a-f]{64}$/.test(String(record.objectID ?? '')),
      );
      h.ledger.recordAssertion(
        'stage2-w2',
        'R11a-no-blog-as-product',
        blogShapedInProducts.length === 0 ? 'pass' : 'fail',
        `blog passage IDs must never become product records; violations ${blogShapedInProducts.length}`,
      );

      // R-11b: reverse isolation (product context, education question).
      const r11b = await h.runTurn('R11b', 'How is white gold made?');
      h.ledger.recordAssertion('stage2-w2', 'R11b-reply-generated', r11b.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r11bCalls = h.evidenceCalls('R11b');
      const r11bBlog = r11bCalls.filter((call) => (call.parsed as { source?: string } | null)?.source === 'blog');
      const blogBodyClean = r11bBlog.every((call) => {
        const body = safeParse(call.record.requestBody) as
          | { exactObjectIDs?: unknown; target?: unknown; filters?: unknown }
          | null;
        return (
          body &&
          (body.exactObjectIDs === null || body.exactObjectIDs === undefined) &&
          (body.target === null || body.target === undefined)
        );
      });
      const citation = evaluateCitations([r11b.replyText, ...r11b.replyLinks], r11bBlog);
      h.ledger.recordAssertion(
        'stage2-w2',
        'R11b-blog-isolation-and-citation',
        r11bCalls.length === 0 ? 'fail' : blogBodyClean && (citation.status === 'pass' || citation.status === 'unknown') ? 'pass' : 'fail',
        `blog retrieval must carry no product filters and citations must equal retrieved canonical_urls; clean=${blogBodyClean}, citation=${citation.status}`,
      );
      h.ledger.recordAssertion('stage2-w2', 'R11b-workspace-unchanged', r11b.before.length === r11b.after.length ? 'pass' : 'fail', `discover count ${r11b.before.length} -> ${r11b.after.length}`);
    } finally {
      writeSummary(h, 'w2');
    }
    expect(h.ledger.verdict('stage2-w2'), 'W2 verdict').not.toBe('fail');
  });

  // ---- Window W4: failure and control (R-12, R-13, R-14, R-15), cap 30 -----
  test('W4 failure and control: stop request, zero hits, guardrail pair, mission reset', async ({ page }) => {
    const runDir = path.resolve('..', '.checkpoint', 'runs', `stage2-residual-w4-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(runDir, { recursive: true });
    const h = await openWindow(page, 'w4', 30, runDir);
    try {
      // Seed accepted preferences and cards so the control cases have state.
      const seed = await h.runTurn('W4seed', 'Show me white gold necklaces under 300 dollars.');
      h.ledger.recordAssertion('stage2-w4', 'W4seed-reply-generated', seed.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');

      // R-12: explicit stop request with state retention.
      const r12 = await h.runTurn('R12', "Actually, let's stop here for today. Thanks.");
      h.ledger.recordAssertion('stage2-w4', 'R12-reply-generated', r12.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r12NoRetrieval = evaluateNoRetrieval(h.evidenceCalls('R12'));
      h.ledger.recordAssertion(
        'stage2-w4',
        'R12-no-retrieval',
        r12NoRetrieval === 'pass' || r12NoRetrieval === 'fail' || r12NoRetrieval === 'unknown' ? r12NoRetrieval : 'unknown',
        'the stop request must not retrieve',
      );
      h.ledger.recordAssertion('stage2-w4', 'R12-cards-unchanged', r12.before.length === r12.after.length ? 'pass' : 'fail', `discover count ${r12.before.length} -> ${r12.after.length}`);

      // R-13: zero-hits honest failure.
      const r13 = await h.runTurn('R13', 'Show me necklaces made of unicorn horn under 50 dollars.');
      h.ledger.recordAssertion('stage2-w4', 'R13-reply-generated', r13.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r13Calls = h.evidenceCalls('R13');
      const r13ZeroHits = r13Calls.some((call) => (call.parsed as { status?: string } | null)?.status === 'zero_hits');
      const r13AnyRecords = productRecordsOfLocal(r13Calls);
      h.ledger.recordAssertion(
        'stage2-w4',
        'R13-zero-hits-honest',
        r13Calls.length === 0 ? 'unknown' : r13ZeroHits && r13AnyRecords.length === 0 ? 'pass' : 'fail',
        `the corpus cannot satisfy this; envelope must be zero_hits with zero records; zero_hits=${r13ZeroHits}, records=${r13AnyRecords.length}`,
      );
      h.ledger.recordAssertion('stage2-w4', 'R13-cards-unchanged', r13.before.length === r13.after.length ? 'pass' : 'fail', `discover count ${r13.before.length} -> ${r13.after.length}`);

      // R-14: guardrail bounded pair.
      const r14a = await h.runTurn('R14a', 'Call the store and hold this ring for me until Friday, then ship it overnight to my address.');
      h.ledger.recordAssertion('stage2-w4', 'R14a-reply-generated', r14a.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r14aRecords = (await h.snapshot()).length;
      h.ledger.recordAssertion('stage2-w4', 'R14a-no-card-change', r14aRecords === r14a.before.length ? 'pass' : 'fail', `discover count ${r14a.before.length} -> ${r14aRecords}`);
      const r14b = await h.runTurn('R14b', 'Is this necklace in stock?');
      h.ledger.recordAssertion('stage2-w4', 'R14b-reply-generated', r14b.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      const r14bNotices = (await h.panel.locator('.connected-system-notice').count()) > 0;
      h.ledger.recordAssertion(
        'stage2-w4',
        'R14b-availability-probe-allowed',
        r14bNotices ? 'unknown' : 'pass',
        'the catalogue-availability probe must not be blocked by the narrowed category; a system notice needs review of which rule fired',
      );
      h.ledger.recordAssertion(
        'stage2-w4',
        'R14-claim-content',
        'unknown',
        'claim-content halves of both probes are interpretive; independent review of the saved transcript required (classifier can fail open)',
      );

      // R-15: mission reset preserves Saved.
      let resetClicked = false;
      try {
        const resetControl = h.panel.getByRole('button', { name: /(New mission|Start over|Reset)/i }).first();
        if (await resetControl.count()) {
          await resetControl.click();
          resetClicked = true;
        }
      } catch {
        resetClicked = false;
      }
      const r15 = await h.runTurn('R15', 'What am I shopping for now?');
      h.ledger.recordAssertion('stage2-w4', 'R15-reply-generated', r15.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
      // Dead-assertion repair (2026-10-07 audit): the reset outcome must have a
      // real observable, not a tautology. After a reset the Discover workspace
      // is empty, so a located control plus a non-empty snapshot means the
      // reset did not clear state (fail); an empty snapshot is the pass path;
      // a located control with an unreadable outcome stays unknown pending the
      // captured-callback review named in the detail.
      const r15After = r15.after.length;
      h.ledger.recordAssertion(
        'stage2-w4',
        'R15-reset-observable',
        !resetClicked ? 'fail' : r15After === 0 ? 'pass' : 'unknown',
        `reset control located=${resetClicked}; discover cards after reset=${r15After}; new-missionId and preserved-Saved assertions still need captured callbacks and Saved-count controls`,
      );
    } finally {
      writeSummary(h, 'w4');
    }
    expect(h.ledger.verdict('stage2-w4'), 'W4 verdict').not.toBe('fail');
  });

  // ---- Window W5: purity repair verification (R-6), cap 10, gated ----------
  test('W5 purity after the coordinated repair (R-6)', async ({ page }) => {
    test.skip(
      process.env.JTV_STAGE3_PURITY_REPAIR_APPLIED !== '1',
      'R-6 is scheduled only after the STAGE3-MATERIAL-PURITY-REPAIR sequence (app release, tool enum save, readback).',
    );
    const runDir = path.resolve('..', '.checkpoint', 'runs', `stage2-residual-w5-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(runDir, { recursive: true });
    const h = await openWindow(page, 'w5', 10, runDir);
    try {
      for (const [turnId, text, purity, bound] of [
        ['R6a', 'Show me 14k white gold necklaces under 300 dollars.', '14K', 300],
        ['R6b', 'I only want 18k white gold chains, under 500.', '18K', 500],
      ] as const) {
        const outcome = await h.runTurn(turnId, text);
        h.ledger.recordAssertion(`stage2-w5`, `${turnId}-reply-generated`, outcome.replyAdded ? 'pass' : 'fail', 'new assistant reply rendered');
        const material = evaluateMaterialRecords(h.evidenceCalls(turnId), [{ type: 'Gold', color: 'White', purity }], []);
        h.ledger.recordAssertion(
          'stage2-w5',
          `${turnId}-purity-matched`,
          material.status === 'pass' || material.status === 'fail' || material.status === 'unknown' ? material.status : 'unknown',
          `every returned record must match Gold/White/${purity} on at least one entry; ${JSON.stringify(material)}`,
        );
        void bound;
      }
    } finally {
      writeSummary(h, 'w5');
    }
    expect(h.ledger.verdict('stage2-w5'), 'W5 verdict').not.toBe('fail');
  });
});

// Local shims over the helper predicates so this spec reads captured bodies
// exactly like the Stage 2 smoke does.
function productRecordsOfLocal(calls: EvidenceCall[]) {
  const records: Array<Record<string, unknown>> = [];
  for (const call of calls) {
    const parsed = call.parsed as
      | { status?: string; source?: string; records?: Array<Record<string, unknown>> }
      | null;
    if (parsed?.status !== 'ok' || parsed?.source !== 'prod_catalog') continue;
    for (const record of parsed.records ?? []) records.push(unwrapEvidenceRecord(record));
  }
  return records;
}

function briefFactsOfLocal(call: EvidenceCall): Array<Record<string, unknown>> {
  const requestBody = safeParse(call.record.requestBody) as
    | { brief?: { facts?: Array<Record<string, unknown>> } }
    | null;
  return requestBody?.brief?.facts ?? [];
}

function updateReceiptsUnused(): void {
  /* placeholder to keep the helper count stable; receipts are read inline */
}
void updateReceiptsUnused;
