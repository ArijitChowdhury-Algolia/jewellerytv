import { expect, test, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CampaignLedger, classifyRequestKind } from './accounting.mjs';
import {
  ASSISTANT_REPLY_CLASS,
  evaluateCitations,
  unwrapEvidenceRecord,
} from './stage2-smoke-helpers.mjs';

// Stage 4 anniversary journey (STAGE4-ANNIVERSARY-JOURNEY-PLAN-2026-10-07.md):
// ONE complete uninterrupted paid shopper mission, turns A1 through A8, through
// the real published Concierge via the actual UI. Opt-in only; the skip path
// touches nothing.
//
// BUDGET RECONCILIATION (docs/config/concierge-development/run-budget.json):
// JTV_MAX_COMPLETION_REQUESTS is a HARNESS STOP CONDITION on the harness's own
// request budget, not an assistant-chosen cap on tokens or depth. Plan
// derivation: 8 planned shopper turns x 5 completions at the upper bound = 40.
// Documented invocation:
//   JTV_RUN_STAGE4_JOURNEY=1 JTV_MAX_COMPLETION_REQUESTS=40
//
// Prior-failure guards (October 6 defect): the category request must compile
// Catalog_ProductType=Necklace at requirement strength with a non-null target,
// and every presented card's record must be a necklace by catalogue product
// type. A pendant presented as a necklace fails automatically.
//
// A1/A2 HALT RULE: if turn A1 or A2 fails or is inconclusive, later paid turns
// do not run; they are recorded 'not-run' and the ledger keeps the first
// failure for diagnosis.

const live = process.env.JTV_RUN_STAGE4_JOURNEY === '1';
const requestedBudget = Number(process.env.JTV_MAX_COMPLETION_REQUESTS ?? 40);
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

const runDir = path.resolve(
  '..',
  '.checkpoint',
  'runs',
  `stage4-anniversary-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const requests: RequestRecord[] = [];
const offAllowlist: string[] = [];
const turnSnapshots: Array<{
  turn: string;
  text: string;
  reply: string;
  replyLinks: string[];
  discoverCount: number;
  cardIds: string[];
  cardTexts: string[];
  elapsedMs: number;
  at: string;
}> = [];

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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

function replyCount(panel: ReturnType<Page['getByRole']>) {
  return panel.locator(`.${ASSISTANT_REPLY_CLASS}`).count();
}

function noticeCount(panel: ReturnType<Page['getByRole']>) {
  return panel.locator('.connected-system-notice').count();
}

function replyLocator(panel: ReturnType<Page['getByRole']>) {
  return panel.locator(`.${ASSISTANT_REPLY_CLASS}`);
}

/**
 * Workspace snapshot: active Discover card identities. Cards link their product
 * as /product/<objectID>; a card without a resolvable link is recorded with
 * id 'identity-unknown' and the presentation oracle treats it as unknown,
 * never as a pass.
 */
async function workspaceSnapshot(workspace: ReturnType<Page['getByRole']>) {
  await chooseView(workspace, 'Discover');
  await expect(workspace.locator('.pw-discover')).toBeVisible({ timeout: 10_000 });
  return workspace.locator('.pw-discover .pw-product').evaluateAll((nodes) =>
    nodes.map((node) => {
      // ProductWorkspace.tsx renders each card as article.pw-product with
      // data-product-id; the href assumption was wrong (measured on the first
      // paid run, where all four cards came back identity-unknown).
      const id = node.getAttribute('data-product-id') ?? '';
      return {
        id: id || 'identity-unknown',
        text: (node.textContent ?? '').slice(0, 220),
      };
    }),
  );
}

test('Stage 4 uninterrupted tenth-anniversary journey A1-A8', async ({ page }, testInfo) => {
  test.skip(!live, 'Paid journey is opt-in (JTV_RUN_STAGE4_JOURNEY=1).');
  test.skip(!budgetReady, 'JTV_MAX_COMPLETION_REQUESTS must be a positive integer.');
  fs.mkdirSync(runDir, { recursive: true });
  const ledger = new CampaignLedger({ maximumCompletionRequests: requestedBudget });

  let activeTurn: string | null = null;
  const pending: Promise<void>[] = [];
  let completionRequests = 0;

  // Harness stop condition: block further completions beyond the budget so a
  // runaway turn cannot spend without bound; the ledger records the stop.
  await page.route('**/api/chat', async (route) => {
    completionRequests += 1;
    if (completionRequests > requestedBudget) {
      ledger.stopForHarnessDefect(`Completion budget ${requestedBudget} exceeded.`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  async function capture(request: Request, turn: string) {
    const response = await request.response();
    let body: string | null = null;
    let status: number | null = null;
    let failed = false;
    if (response) {
      status = response.status();
      try {
        body = await response.text();
      } catch {
        failed = true;
      }
    } else {
      failed = true;
    }
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
    // Classify chat requests as completion / continuation / retry the same way
    // the Stage 2 ledger does: a byte-identical repeat body is a retry, a
    // distinct body inside the same turn is a continuation.
    if (record.url.includes('/api/chat')) {
      const priorBodies = requests
        .filter((r) => r.turn === turn && r.url.includes('/api/chat') && r !== record)
        .map((r) => r.requestBody);
      const kind = classifyRequestKind(record, priorBodies);
      ledger.recordRequest(
        'stage4-anniversary',
        turn,
        kind,
        `stage4:${turn}:${requests.filter((r) => r.turn === turn).length}`,
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
      2),
    );
  }

  page.on('request', (request) => {
    const url = request.url();
    if (!INTERCEPTED.some((fragment) => url.includes(fragment))) {
      // Global allowlist: local app, JTV product/article images, fonts, assets.
      if (
        !/localhost|127\.0\.0\.1|images\.jtv\.com|www\.jtv\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|\/assets\/|favicon|\.(css|js|png|jpe?g|svg|webp|woff2?)(\?|$)/.test(
          url,
        )
      ) {
        offAllowlist.push(url);
        ledger.stopForHarnessDefect(`Request outside the allowlist: ${url}`);
      }
      return;
    }
    if (url.includes('/api/chat') && !activeTurn) {
      ledger.stopForHarnessDefect('Completion request outside a shopper turn.');
      return;
    }
    const turn = activeTurn ?? 'outside-turn';
    pending.push(capture(request, turn).catch(() => undefined));
  });

  const panel = await openConcierge(page);
  const workspace = panel.getByRole('region', { name: 'Shopping choices' });
  await page.screenshot({ path: path.join(runDir, '00-open-viewport.png'), fullPage: false });

  const evidenceCalls = (turn: string): EvidenceCall[] =>
    requests
      .filter((r) => r.turn === turn && r.url.includes('/api/agent-evidence'))
      .map((record) => {
        const parsed = safeParse(record.responseBody);
        const captured =
          !record.failed && record.status === 200 && parsed !== null && typeof parsed === 'object';
        return { captured, parsed, record };
      });

  const briefFactsOf = (call: EvidenceCall): Array<Record<string, unknown>> => {
    const parsed = call.parsed as { requestBody?: unknown } | null;
    // The evidence REQUEST body is captured in record.requestBody; the response
    // body is the envelope. Brief facts live on the request side.
    const requestBody = safeParse(call.record.requestBody) as
      | { brief?: { facts?: Array<Record<string, unknown>> } }
      | null;
    void parsed;
    return requestBody?.brief?.facts ?? [];
  };

  const productRecordsOf = (calls: EvidenceCall[]) => {
    const records: Array<Record<string, unknown>> = [];
    for (const call of calls) {
      const parsed = call.parsed as
        | { status?: string; source?: string; records?: Array<Record<string, unknown>> }
        | null;
      if (parsed?.status !== 'ok' || parsed?.source !== 'prod_catalog') continue;
      for (const record of parsed.records ?? []) records.push(unwrapEvidenceRecord(record));
    }
    return records;
  };

  const blogCanonicalUrls = (calls: EvidenceCall[]) => {
    const urls: string[] = [];
    for (const call of calls) {
      const parsed = call.parsed as
        | { status?: string; source?: string; records?: Array<Record<string, unknown>> }
        | null;
      if (parsed?.status !== 'ok' || parsed?.source !== 'blog') continue;
      for (const record of parsed.records ?? []) {
        const canonical = unwrapEvidenceRecord(record)?.canonical_url;
        if (typeof canonical === 'string' && canonical.startsWith('https://')) urls.push(canonical);
      }
    }
    return urls;
  };

  const hasNecklaceTypeFilter = (calls: EvidenceCall[]) => {
    // Pass requires BOTH: a typed requirement fact in the request-side brief
    // AND the compiled filter in an observed response. Either absent = unknown.
    const typedFact = calls.some((call) =>
      briefFactsOf(call).some(
        (fact) =>
          fact.field === 'product_type' &&
          (fact.value as { kind?: string; attribute?: string; values?: string[] })?.kind ===
            'facet' &&
          (fact.value as { attribute?: string })?.attribute === 'Catalog_ProductType' &&
          ((fact.value as { values?: string[] })?.values ?? []).includes('Necklace') &&
          fact.strength === 'requirement' &&
          fact.certainty === 'explicit',
      ),
    );
    const compiledFilter = calls.some((call) => {
      const parsed = call.parsed as { effectiveFilters?: Array<Record<string, unknown>> } | null;
      return (parsed?.effectiveFilters ?? []).some(
        (filter) =>
          filter.field === 'Catalog_ProductType' &&
          (filter.operator === 'eq' || filter.operator === 'any') &&
          String(filter.value ?? '').includes('Necklace'),
      );
    });
    return { typedFact, compiledFilter };
  };

  let halted = false;

  async function runTurn(turnId: string, text: string) {
    ledger.startTurn('stage4-anniversary', turnId);
    activeTurn = turnId;
    const startedAt = Date.now();
    const captureFrom = pending.length;
    const repliesBefore = await replyCount(panel);
    const noticesBefore = await noticeCount(panel);
    const before = await workspaceSnapshot(workspace);
    const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
    await input.fill(text);
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(input).toBeDisabled();
    await expect(input).toBeEnabled({ timeout: 120_000 });
    activeTurn = null;
    await Promise.all(pending.slice(captureFrom));
    try {
      await expect
        .poll(
          async () =>
            (await replyCount(panel)) > repliesBefore || (await noticeCount(panel)) > noticesBefore,
          { timeout: 5_000 },
        )
        .toBe(true);
    } catch {
      /* absence is recorded by assertions below, never as a pass */
    }
    const replyAdded = (await replyCount(panel)) > repliesBefore;
    const replyText = replyAdded
      ? ((await replyLocator(panel).last().textContent()) ?? '').trim()
      : '';
    const replyLinks = replyAdded
      ? await replyLocator(panel)
          .last()
          .locator('a')
          .evaluateAll((nodes) =>
            nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? '').filter(Boolean),
          )
      : [];
    const after = await workspaceSnapshot(workspace);
    const elapsedMs = Date.now() - startedAt;
    await page.screenshot({ path: path.join(runDir, `turn-${turnId}-viewport.png`) });
    await workspace.screenshot({ path: path.join(runDir, `turn-${turnId}-workspace.png`) });
    turnSnapshots.push({
      turn: turnId,
      text,
      reply: replyText,
      replyLinks,
      discoverCount: after.length,
      cardIds: after.map((card) => card.id),
      cardTexts: after.map((card) => card.text),
      elapsedMs,
      at: new Date().toISOString(),
    });
    fs.writeFileSync(
      path.join(runDir, `turn-${turnId}-snapshot.json`),
      JSON.stringify({ text, replyText, replyLinks, before, after, elapsedMs }, null, 2),
    );
    return { replyAdded: replyAdded && replyText.length > 0, replyText, replyLinks, before, after };
  }

  const assertCommon = (turnId: string, outcome: Awaited<ReturnType<typeof runTurn>>) => {
    ledger.recordAssertion(
      'stage4-anniversary',
      `${turnId}-reply-generated`,
      outcome.replyAdded ? 'pass' : 'fail',
      outcome.replyAdded ? 'new assistant reply rendered' : 'no new assistant reply rendered',
    );
    ledger.recordAssertion(
      'stage4-anniversary',
      `${turnId}-no-em-dash`,
      outcome.replyText.includes('—') ? 'fail' : 'pass',
      'generated reply must not contain an em dash',
    );
  };

  // ---- Turn A1: occasion and brief intake ---------------------------------
  const a1 = await runTurn('A1', 'Need help picking something for ten years of marriage. Understated, white gold, $500 combined.');
  assertCommon('A1', a1);
  const a1Calls = evidenceCalls('A1');
  ledger.recordAssertion(
    'stage4-anniversary',
    'A1-no-retrieval',
    a1Calls.length === 0 ? 'pass' : 'fail',
    `intake turn must not retrieve; ${a1Calls.length} evidence calls observed`,
  );
  ledger.recordAssertion(
    'stage4-anniversary',
    'A1-no-cards',
    a1.after.length === a1.before.length ? 'pass' : 'fail',
    `no cards during intake; discover count ${a1.before.length} -> ${a1.after.length}`,
  );

  // ---- Turn A2: known wear, unknown ring size ------------------------------
  const a2 = await runTurn('A2', "She wears small studs day to day and her wedding ring, but I honestly don't know her ring size.");
  assertCommon('A2', a2);
  const a2Calls = evidenceCalls('A2');
  const a2ProductRecords = productRecordsOf(a2Calls);
  const a2BlogCall = a2Calls.some((call) => {
    const parsed = call.parsed as { source?: string } | null;
    return parsed?.source === 'blog';
  });
  const a2UnknownCards = a2.after.filter((card) => card.id === 'identity-unknown');
  const a2Untraced = a2.after.filter(
    (card) => card.id !== 'identity-unknown' && !a2ProductRecords.some((r) => r.objectID === card.id),
  );
  ledger.recordAssertion(
    'stage4-anniversary',
    'A2-cards-trace-to-retrieval',
    a2BlogCall
      ? 'fail'
      : a2UnknownCards.length > 0
        ? 'unknown'
        : a2Untraced.length === 0
          ? 'pass'
          : 'fail',
    `any presented card must trace to a retrieved objectID; unknown-identity cards ${a2UnknownCards.length}, untraced ${a2Untraced.length}, blog call ${a2BlogCall}`,
  );

  // Halt rule: a failed or inconclusive A1 or A2 stops later paid turns.
  const a1Statuses = Object.entries(ledger.assertions('stage4-anniversary'))
    .filter(([key]) => key.startsWith('A1-') || key.startsWith('A2-'))
    .map(([, value]) => value.status);
  if (a1Statuses.includes('fail') || a1Statuses.includes('unknown')) {
    halted = true;
    ledger.recordAssertion(
      'stage4-anniversary',
      'halt-rule-applied',
      'fail',
      'A1 or A2 failed or is inconclusive; later paid turns withheld for diagnosis (plan halt rule)',
    );
  }

  // ---- Turn A3: category request, phrasing one -----------------------------
  if (!halted) {
    const a3 = await runTurn('A3', 'Necklaces with small blue stones, white gold, and keep the whole gift under $500. No hearts.');
    assertCommon('A3', a3);
    const a3Calls = evidenceCalls('A3');
    const a3Products = productRecordsOf(a3Calls);
    const { typedFact, compiledFilter } = hasNecklaceTypeFilter(a3Calls);
    ledger.recordAssertion(
      'stage4-anniversary',
      'A3-necklace-requirement-typed',
      typedFact ? 'pass' : 'fail',
      'the category request must compile product_type Necklace as an explicit requirement fact (request-side brief)',
    );
    ledger.recordAssertion(
      'stage4-anniversary',
      'A3-necklace-filter-compiled',
      compiledFilter ? 'pass' : 'fail',
      'the compiled filter for Catalog_ProductType Necklace must appear in an observed evidence response (not just HTTP 200)',
    );
    const a3Unknown = a3.after.filter((card) => card.id === 'identity-unknown');
    const a3NonNecklace = a3.after.filter((card) => {
      if (card.id === 'identity-unknown') return false;
      const record = a3Products.find((r) => r.objectID === card.id);
      return record ? record.Catalog_ProductType !== 'Necklace' : false;
    });
    const a3Untraced = a3.after.filter(
      (card) => card.id !== 'identity-unknown' && !a3Products.some((r) => r.objectID === card.id),
    );
    ledger.recordAssertion(
      'stage4-anniversary',
      'A3-no-pendant-presented',
      a3Unknown.length > 0 ? 'unknown' : a3NonNecklace.length === 0 ? 'pass' : 'fail',
      `every presented card must be a catalogue Necklace (prior-failure guard); non-necklace ${a3NonNecklace.length}, identity-unknown ${a3Unknown.length}`,
    );
    ledger.recordAssertion(
      'stage4-anniversary',
      'A3-cards-trace-to-retrieval',
      a3Untraced.length === 0 && a3Unknown.length === 0 ? 'pass' : a3Untraced.length > 0 ? 'fail' : 'unknown',
      `cards must trace to retrieved objectIDs (B26); untraced ${a3Untraced.length}`,
    );
    const a3BlogCall = a3Calls.some((call) => {
      const parsed = call.parsed as { source?: string } | null;
      return parsed?.source === 'blog';
    });
    ledger.recordAssertion(
      'stage4-anniversary',
      'A3-no-blog-call',
      a3BlogCall ? 'fail' : a3Calls.length === 0 ? 'fail' : 'pass',
      'the category turn must retrieve prod_catalog, not blog (E31)',
    );
  } else {
    ledger.recordAssertion('stage4-anniversary', 'A3-not-run', 'not-run', 'halted after A1/A2');
  }

  // ---- Turn A4: blog education detour --------------------------------------
  if (!halted) {
    const a4 = await runTurn('A4', 'Teach me about lab-created versus natural sapphires.');
    assertCommon('A4', a4);
    const a4Calls = evidenceCalls('A4');
    const a4Blog = a4Calls.filter((call) => {
      const parsed = call.parsed as { source?: string } | null;
      return parsed?.source === 'blog';
    });
    const a4Product = a4Calls.filter((call) => {
      const parsed = call.parsed as { source?: string } | null;
      return parsed?.source === 'prod_catalog';
    });
    ledger.recordAssertion(
      'stage4-anniversary',
      'A4-blog-only',
      a4Calls.length === 0 ? 'fail' : a4Product.length === 0 ? 'pass' : 'fail',
      `education detour must retrieve blog only; product calls ${a4Product.length}`,
    );
    const canonical = blogCanonicalUrls(a4Blog);
    const citation = evaluateCitations([a4.replyText, ...a4.replyLinks], a4Blog);
    ledger.recordAssertion(
      'stage4-anniversary',
      'A4-citation-supported',
      citation.status === 'pass' || citation.status === 'fail' || citation.status === 'unknown'
        ? citation.status
        : 'unknown',
      `every rendered href must equal a retrieved canonical_url; retrieved canonical ${canonical.length}; ${JSON.stringify(citation)}`,
    );
    ledger.recordAssertion(
      'stage4-anniversary',
      'A4-cards-unchanged',
      a4.before.length === a4.after.length &&
        JSON.stringify(a4.before) === JSON.stringify(a4.after)
        ? 'pass'
        : 'fail',
      `product state and cards untouched through the detour; ${a4.before.length} -> ${a4.after.length}`,
    );
  } else {
    ledger.recordAssertion('stage4-anniversary', 'A4-not-run', 'not-run', 'halted after A1/A2');
  }

  // ---- Turn A5: return to the mission, phrasing two ------------------------
  if (!halted) {
    const a5 = await runTurn('A5', 'Good to know. Now show me those white gold necklaces with the blue stones again.');
    assertCommon('A5', a5);
    const a5Calls = evidenceCalls('A5');
    const a5Products = productRecordsOf(a5Calls);
    if (a5Calls.length > 0) {
      const { typedFact } = hasNecklaceTypeFilter(a5Calls);
      ledger.recordAssertion(
        'stage4-anniversary',
        'A5-compile-on-return',
        typedFact ? 'pass' : 'fail',
        'any retrieval fired after the detour must still compile the Necklace requirement without the shopper repeating the numbers',
      );
      const a5NonNecklace = a5.after.filter((card) => {
        if (card.id === 'identity-unknown') return false;
        const record = a5Products.find((r) => r.objectID === card.id);
        return record ? record.Catalog_ProductType !== 'Necklace' : false;
      });
      ledger.recordAssertion(
        'stage4-anniversary',
        'A5-no-substitution',
        a5NonNecklace.length === 0 ? 'pass' : 'fail',
        `no non-necklace substitution after the detour; violations ${a5NonNecklace.length}`,
      );
    } else {
      ledger.recordAssertion(
        'stage4-anniversary',
        'A5-compile-on-return',
        'unknown',
        'no retrieval fired; brief survival is not observable in the browser this turn',
      );
    }
    const a5BlogCall = a5Calls.some((call) => {
      const parsed = call.parsed as { source?: string } | null;
      return parsed?.source === 'blog';
    });
    ledger.recordAssertion(
      'stage4-anniversary',
      'A5-no-blog-call',
      a5BlogCall ? 'fail' : 'pass',
      'the return turn must not fan out to blog',
    );
  } else {
    ledger.recordAssertion('stage4-anniversary', 'A5-not-run', 'not-run', 'halted after A1/A2');
  }

  // ---- Turn A6: reaction to a dressy setting -------------------------------
  if (!halted) {
    const a6 = await runTurn('A6', 'The second one is nice. Do you have anything a little dressier, still delicate and in 14k white gold?');
    assertCommon('A6', a6);
    const a6Calls = evidenceCalls('A6');
    const a6Products = productRecordsOf(a6Calls);
    const a6Unknown = a6.after.filter((card) => card.id === 'identity-unknown');
    const a6Untraced = a6.after.filter(
      (card) => card.id !== 'identity-unknown' && !a6Products.some((r) => r.objectID === card.id),
    );
    ledger.recordAssertion(
      'stage4-anniversary',
      'A6-cards-trace-to-retrieval',
      a6Untraced.length === 0 && a6Unknown.length === 0 ? 'pass' : a6Untraced.length > 0 ? 'fail' : 'unknown',
      `every presented card traces to a retrieved objectID; untraced ${a6Untraced.length}, unknown ${a6Unknown.length}`,
    );
    const a6NonNecklace = a6.after.filter((card) => {
      if (card.id === 'identity-unknown') return false;
      const record = a6Products.find((r) => r.objectID === card.id);
      return record ? record.Catalog_ProductType !== 'Necklace' : false;
    });
    ledger.recordAssertion(
      'stage4-anniversary',
      'A6-all-necklaces',
      a6Unknown.length > 0 ? 'unknown' : a6NonNecklace.length === 0 ? 'pass' : 'fail',
      `every presented record is a necklace by catalogue type; violations ${a6NonNecklace.length}`,
    );
    // Material claims per card must be supported by that record's own entries:
    // each presented record must carry at least one white-gold or sterling entry.
    const a6MaterialUnsupported = a6.after.filter((card) => {
      if (card.id === 'identity-unknown') return false;
      const record = a6Products.find((r) => r.objectID === card.id);
      const materials = (record?.Catalog_MaterialInformation ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(materials) || materials.length === 0) return true;
      return !materials.some(
        (entry) =>
          (entry.MaterialType === 'Gold' && entry.MaterialColor === 'White') ||
          (entry.MaterialType === 'Silver' && entry.MaterialColor === 'White'),
      );
    });
    ledger.recordAssertion(
      'stage4-anniversary',
      'A6-material-supported-per-record',
      a6Unknown.length > 0 ? 'unknown' : a6MaterialUnsupported.length === 0 ? 'pass' : 'fail',
      `material claims must come from the record's own Catalog_MaterialInformation; unsupported ${a6MaterialUnsupported.length}`,
    );
  } else {
    ledger.recordAssertion('stage4-anniversary', 'A6-not-run', 'not-run', 'halted after A1/A2');
  }

  // ---- Turn A7: budget correction mid-mission ------------------------------
  if (!halted) {
    const a7 = await runTurn('A7', 'Actually, I can stretch to $600 all in if it opens up something better.');
    assertCommon('A7', a7);
    const a7Calls = evidenceCalls('A7');
    if (a7Calls.length > 0) {
      const bound600 = a7Calls.some((call) => {
        const fromFacts = briefFactsOf(call).some(
          (fact) =>
            fact.field === 'budget' &&
            (fact.value as { kind?: string; cents?: number; operator?: string })?.kind === 'money' &&
            (fact.value as { cents?: number })?.cents === 60000,
        );
        const parsed = call.parsed as { effectiveFilters?: Array<Record<string, unknown>> } | null;
        const fromFilters = (parsed?.effectiveFilters ?? []).some(
          (filter) =>
            filter.field === 'Pricing_ActivePrice' &&
            (filter.operator === 'lte' || filter.operator === 'lt') &&
            Number(filter.value) === 600,
        );
        return fromFacts || fromFilters;
      });
      const bound500 = a7Calls.some((call) => {
        const parsed = call.parsed as { effectiveFilters?: Array<Record<string, unknown>> } | null;
        return (parsed?.effectiveFilters ?? []).some(
          (filter) => filter.field === 'Pricing_ActivePrice' && Number(filter.value) === 500,
        );
      });
      ledger.recordAssertion(
        'stage4-anniversary',
        'A7-bound-superseded',
        bound500 ? 'fail' : bound600 ? 'pass' : 'unknown',
        `if retrieval fires the bound must reflect 600, never 500; observed 600=${bound600}, 500=${bound500}`,
      );
    } else {
      ledger.recordAssertion(
        'stage4-anniversary',
        'A7-bound-superseded',
        'unknown',
        'no retrieval fired; supersession is not observable in the browser this turn',
      );
    }
  } else {
    ledger.recordAssertion('stage4-anniversary', 'A7-not-run', 'not-run', 'halted after A1/A2');
  }

  // ---- Turn A8: explicit stop ----------------------------------------------
  if (!halted) {
    const a8 = await runTurn('A8', "That's the one. Stop showing alternatives.");
    assertCommon('A8', a8);
    const a8Calls = evidenceCalls('A8');
    ledger.recordAssertion(
      'stage4-anniversary',
      'A8-no-tool-fanout',
      a8Calls.length === 0 ? 'pass' : 'fail',
      `the close must not fan out; ${a8Calls.length} evidence calls observed`,
    );
    ledger.recordAssertion(
      'stage4-anniversary',
      'A8-no-new-cards',
      a8.before.length === a8.after.length ? 'pass' : 'fail',
      `no new cards at the close; ${a8.before.length} -> ${a8.after.length}`,
    );
    const earlierReplies = turnSnapshots.filter((t) => t.turn !== 'A8').map((t) => t.reply);
    ledger.recordAssertion(
      'stage4-anniversary',
      'A8-not-templated',
      earlierReplies.some((reply) => reply === a8.replyText) ? 'fail' : 'pass',
      'the close reply must not be byte-identical to any earlier reply (automatic-fail 10)',
    );
  } else {
    ledger.recordAssertion('stage4-anniversary', 'A8-not-run', 'not-run', 'halted after A1/A2');
  }

  // ---- Cross-turn checks ----------------------------------------------------
  const replies = turnSnapshots.map((t) => ({ turn: t.turn, reply: t.reply }));
  let repetitionFound = false;
  for (let i = 0; i < replies.length && !repetitionFound; i += 1) {
    for (let j = i + 1; j < replies.length; j += 1) {
      if (
        replies[i].reply.length >= 80 &&
        replies[i].reply.slice(0, 80) === replies[j].reply.slice(0, 80)
      ) {
        repetitionFound = true;
        ledger.recordAssertion(
          'stage4-anniversary',
          'replies-not-templated',
          'fail',
          `replies ${replies[i].turn} and ${replies[j].turn} share an identical 80-character opening`,
        );
        break;
      }
    }
  }
  if (!repetitionFound && replies.length >= 2)
    ledger.recordAssertion('stage4-anniversary', 'replies-not-templated', 'pass', 'no two replies share an 80-character opening');

  // Interpretive dimensions: recorded as unknown for the independent reviewer.
  for (const [id, detail] of [
    ['warmth-and-tone', 'interpretive; independent review required'],
    ['grounding-of-claims', 'interpretive; independent review required'],
    ['intake-burden', 'interpretive; independent review required'],
    ['state-narrative', 'interpretive where revision IDs are not observable; independent review with dashboard readback option'],
  ] as const)
    ledger.recordAssertion('stage4-anniversary', id, 'unknown', detail);

  const summary = {
    journey: 'stage4-anniversary',
    at: new Date().toISOString(),
    totals: ledger.totals(),
    verdict: ledger.verdict('stage4-anniversary'),
    firstFailure: ledger.firstFailure('stage4-anniversary'),
    halted,
    assertions: ledger.assertions('stage4-anniversary'),
    turns: turnSnapshots.map(({ turn, text, reply, replyLinks, discoverCount, cardIds, elapsedMs }) => ({
      turn,
      text,
      reply,
      replyLinks,
      discoverCount,
      cardIds,
      elapsedMs,
    })),
    offAllowlist,
    screenshots: fs.existsSync(runDir) ? fs.readdirSync(runDir).filter((f) => f.endsWith('.png')) : [],
  };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(runDir, 'ledger.json'), JSON.stringify(summary.totals, null, 2));
  console.log('STAGE4-SUMMARY', JSON.stringify({ verdict: summary.verdict, totals: summary.totals, halted }, null, 2));

  // The window's own stop conditions: no off-allowlist request; the verdict
  // must not be fail (unknown does not block; a failed case does).
  expect(offAllowlist, 'all requests stay on the allowlist').toEqual([]);
  expect(ledger.verdict('stage4-anniversary'), 'journey verdict (unknowns do not block; fails do)').not.toBe('fail');
});
