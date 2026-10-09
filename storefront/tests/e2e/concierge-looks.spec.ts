// Stage 6 looks/replacement acceptance, offline browser suite.
// Evidence mode per Arijit's standing validation rule: real headless browser,
// all upstream routes stubbed, screenshots at anchor selection, subtotal,
// guardrail/failure and final state, retained DOM receipts and exact IDs.
// Fixture-guaranteed data is labeled as fixtures and never presented as live
// evidence. No assertion reads generated agent prose.
// Machinery proofs (pure functions) are labeled validator/proof only; they do
// not by themselves accept any Stage 6 requirement.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createBriefStateV3 } from '../../shared/briefState.js';
import { V3_SESSION_KEY } from '../../src/concierge/sessionPersistence.js';
// accounting.mjs is a plain JS module without type declarations; evaluation/
// is outside the tsconfig include list, so this import is typed loosely here.
// @ts-expect-error untyped JS module
import { CampaignLedger } from '../../evaluation/concierge-phases-1-3/accounting.mjs';
import { materialMatch, type MaterialRequirement } from '../../server/concierge/materialEvidence.js';
import { presentChoices } from '../../shared/concierge/presentation.js';
import type {
  PresentationContext,
  PresentationEvidence,
} from '../../shared/concierge/presentation-contract.js';
import {
  addCents,
  boundPasses,
  exactPriceCents,
} from '../../shared/concierge/presentation-contract.js';
import { pairTotal } from '../../shared/shopping.js';

const SCREENSHOT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/workspace/stage6-looks/screenshots',
);

// This suite captures its own screenshots; the shared trace/screencast
// recorder corrupts concurrent writes when both config projects run in
// parallel, so it stays off here.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const RUN_ID = 'stage6-looks-local';
const BLOCKERS = {
  claude1C4: 'B1: Claude 1 C4 yellow-gold exclusion fix pending',
  dev2Stage5: 'B2: Dev2 Stage 5 stability pending',
  connectedRun: 'B3: connected agent turn requires coordinated live run',
};

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

const fixtureRecords = Array.from({ length: 5 }, (_, index) => {
  const objectID = `LOOKFIX-${index + 1}`;
  return {
    objectID,
    Catalog_TitleDescription: `Sterling silver sapphire pendant necklace with white gold accents, fixture record ${index + 1}`,
    Pricing_ActivePrice: index === 3 ? null : 120 + index * 30,
    Media_Images: [],
  };
});

const boundRecords = fixtureRecords.map((record) => {
  const contentHash = `hash-${record.objectID}`;
  return {
    sourceIndex: 'prod_catalog' as const,
    objectID: record.objectID,
    raw: record,
    quantity: 1,
    observedAt: null,
    binding: 'evidence_bound' as const,
    contentHash,
    evidenceRef: `prod_catalog/${record.objectID}/${contentHash}`,
  };
});

const session = {
  version: 3 as const,
  missionId: 'stage6-looks-mission',
  brief: createBriefStateV3('stage6-looks-mission'),
  products: boundRecords,
  selectionRecords: boundRecords,
  compareIds: [],
  activeView: 'saved' as const,
  receipts: [],
  evidence: boundRecords.map((record) => ({
    evidenceRef: record.evidenceRef,
    sourceIndex: 'prod_catalog' as const,
    objectID: record.objectID,
    contentHash: record.contentHash,
  })),
  committedProposal: {
    missionId: 'stage6-looks-mission',
    stateRevision: 0,
    evidenceBatchRevision: 1,
    turnId: 'fixture-turn',
    proposalId: 'fixture-look',
    kind: 'complete_looks',
    groups: [
      {
        title: 'Fixture complete look',
        lines: [0, 1].map((index) => ({
          evidenceRef: boundRecords[index].evidenceRef as string,
          objectID: boundRecords[index].objectID,
          contentHash: boundRecords[index].contentHash as string,
          quantity: 1,
          componentSlot: index === 0 ? 'main' : 'companion',
          explanation: `Fixture line ${index + 1}`,
          unitPriceCents: 12000 + index * 3000,
          lineSubtotalCents: 12000 + index * 3000,
        })),
        itemSubtotalCents: 27000,
      },
    ],
    combinedItemSubtotalCents: 27000,
    assessment: { perItem: 'accepted', total: 'accepted', reasons: [] },
  },
};

async function stubAllUpstreams(page: Page) {
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 500, json: { error: 'Chat disabled in offline looks test' } }),
  );
  await page.route('**/api/search', (route) =>
    route.fulfill({
      json: { results: [{ hits: [], nbHits: 0, page: 0, hitsPerPage: 24, exhaustiveNbHits: true, facets: {}, processingTimeMS: 0 }] },
    }),
  );
  await page.route('**/api/agent-evidence', (route) =>
    route.fulfill({ status: 500, json: { error: 'Evidence disabled in offline looks test' } }),
  );
  await page.route('**/api/agent-product-refresh', (route) =>
    route.fulfill({ status: 500, json: { error: 'Refresh disabled in offline looks test' } }),
  );
  await page.route('**/api/products/**', (route) => route.fulfill({ json: { results: [] } }));
  await page.route('**/api/**', (route) => route.abort());
}

async function openWorkspace(page: Page, seedKey: string) {
  await page.addInitScript(
    ({ key, seedKey, value }) => {
      sessionStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem(seedKey, 'done');
    },
    { key: V3_SESSION_KEY, seedKey, value: session },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /open jewelry concierge/i }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  return { panel, workspace: panel.getByRole('region', { name: 'Shopping choices' }) };
}

async function shot(page: Page, name: string, project: string) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, `${project}-${name}.png`);
  writeFileSync(file, await page.screenshot());
  return file;
}

test('stage 6 offline looks acceptance: browser evidence plus machinery proofs', async ({
  browser,
}, testInfo) => {
  const projectName = testInfo.project.name;
  test.setTimeout(120_000);
  const ledger = new CampaignLedger({ maximumCompletionRequests: 500 });
  const screenshots: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const paidUrls: string[] = [];
  page.on('request', (request) => {
    if (/algolia\.net|agent-studio/.test(request.url())) paidUrls.push(request.url());
  });

  // ---- Browser case B1: agent-proposed complete look renders in Selected with subtotal
  try {
    await stubAllUpstreams(page);
    const { workspace } = await openWorkspace(page, 'jtv-test-stage6-looks-b1');
    await workspace
      .getByRole('navigation', { name: 'Product views' })
      .getByRole('button', { name: /^Selected\(5\)$|^Selected \(5\)$/ })
      .click();
    const savedCards = workspace.locator('.pw-saved .pw-grid .pw-product[data-product-id]');
    await expect(savedCards).toHaveCount(5);
    ledger.recordAssertion(
      RUN_ID,
      'B1:saved-cards-present',
      'pass',
      '5 seeded fixture cards visible in Selected view',
    );

    // The seeded committed complete look lands in Selected (no Combination tab).
    const looks = workspace.locator('.pw-proposed-looks .pw-discovery-group');
    await expect(looks).toHaveCount(1);
    screenshots.push(await shot(page, 'b1-look-in-saved', projectName));
    ledger.recordAssertion(
      RUN_ID,
      'B1:look-lands-in-saved',
      'pass',
      'seeded complete look renders in Selected view with no Combination tab',
    );

    const subtotalRegion = workspace.getByText(/Known item subtotal|Item subtotal/).first();
    await expect(subtotalRegion).toBeVisible();
    screenshots.push(await shot(page, 'b1-subtotal', projectName));
    const bodyText = await workspace.textContent();
    const subtotalShown = money(27000);
    const subtotalOk = bodyText?.includes(subtotalShown) ?? false;
    ledger.recordAssertion(
      RUN_ID,
      'B1:subtotal-arithmetic',
      subtotalOk ? 'pass' : 'fail',
      `look subtotal text contains ${subtotalShown} for 120.00 + 150.00 fixture prices`,
    );

    // Seeded look pieces are all saved, so each line carries the Saved mark.
    const savedMarks = await workspace.locator('.pw-proposed-looks').textContent();
    const marksOk = savedMarks?.includes('Selected \u2713') ?? false;
    ledger.recordAssertion(
      RUN_ID,
      'B1:saved-overlap-marks',
      marksOk ? 'pass' : 'fail',
      'look lines overlapping the saved grid are marked Selected',
    );
    expect(await workspace.getByRole('button', { name: 'Add to combination' }).count()).toBe(0);
    screenshots.push(await shot(page, 'b1-final-state', projectName));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ledger.recordAssertion(RUN_ID, 'B1', 'fail', detail);
    screenshots.push(await shot(page, 'b1-failure', projectName));
  }

  // ---- Browser case B3: failed catalogue refresh rolls back, saved data retained
  try {
    const { workspace } = await openWorkspace(page, 'jtv-test-stage6-looks-b3');
    await workspace
      .getByRole('navigation', { name: 'Product views' })
      .getByRole('button', { name: /^Selected/ })
      .click();
    const savedCards = workspace.locator('.pw-saved .pw-grid .pw-product[data-product-id]');
    await expect(savedCards).toHaveCount(5);
    const before = await savedCards.first().textContent();
    // agent-product-refresh is stubbed to fail in stubAllUpstreams; trigger it
    // by switching views, which refreshes saved records.
    await workspace
      .getByRole('navigation', { name: 'Product views' })
      .getByRole('button', { name: /^Discover/ })
      .click();
    await workspace
      .getByRole('navigation', { name: 'Product views' })
      .getByRole('button', { name: /^Selected/ })
      .click();
    await expect(savedCards).toHaveCount(5);
    const after = await savedCards.first().textContent();
    ledger.recordAssertion(
      RUN_ID,
      'B3:failed-refresh-rollback',
      before === after ? 'pass' : 'fail',
      'saved card content identical after a failed refresh; prior information retained',
    );
    screenshots.push(await shot(page, 'b3-refresh-failure', projectName));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ledger.recordAssertion(RUN_ID, 'B3', 'fail', detail);
    screenshots.push(await shot(page, 'b3-failure', projectName));
  }

  await context.close();

  // ---- Machinery proofs (pure functions, fixture-labeled, not acceptance)
  const yellowExclusion: MaterialRequirement = {
    attribute: 'MaterialColor',
    values: ['Yellow'],
    exclude: true,
    factId: 'fixture-exclusion',
  };
  const yellowRecord = {
    Catalog_MaterialInformation: [{ MaterialType: 'Gold', MaterialColor: 'Yellow', MaterialPurity: '14K' }],
  };
  const whiteRecord = {
    Catalog_MaterialInformation: [{ MaterialType: 'Gold', MaterialColor: 'White', MaterialPurity: '14K' }],
  };
  const noColorRecord = {
    Catalog_MaterialInformation: [{ MaterialType: 'Gold', MaterialPurity: '14K' }],
  };
  ledger.recordAssertion(
    RUN_ID,
    'P1:yellow-exclusion-conflict-fixture',
    materialMatch(yellowRecord, [yellowExclusion]) === 'conflict' ? 'pass' : 'fail',
    'fixture proof: MaterialColor Yellow conflicts with a Yellow exclusion',
  );
  ledger.recordAssertion(
    RUN_ID,
    'P1:missing-color-unknown-fixture',
    materialMatch(noColorRecord, [yellowExclusion]) === 'unknown' ? 'pass' : 'fail',
    'fixture proof: record without MaterialColor is unknown, never compliant',
  );
  ledger.recordAssertion(
    RUN_ID,
    'P1:white-record-passes-fixture',
    materialMatch(whiteRecord, [yellowExclusion]) === 'match' ? 'pass' : 'fail',
    'fixture proof: white-gold record matches a Yellow exclusion requirement set',
  );
  ledger.recordAssertion(
    RUN_ID,
    'P2:exact-cents-fixture',
    exactPriceCents({ Pricing_ActivePrice: 199.99 }) === 19999 &&
      exactPriceCents({ Pricing_ActivePrice: 19.99999995 }) === null
      ? 'pass'
      : 'fail',
    'fixture proof: exact cent conversion with float-drift rejection',
  );
  ledger.recordAssertion(
    RUN_ID,
    'P2:boundary-operators-fixture',
    boundPasses(20000, { currency: 'USD', basis: 'per-item', operator: 'lte', cents: 20000 }) &&
      !boundPasses(20000, { currency: 'USD', basis: 'per-item', operator: 'lt', cents: 20000 }) &&
      !boundPasses(20000, { currency: 'USD', basis: 'per-item', operator: 'around', cents: 20000 })
      ? 'pass'
      : 'fail',
    'fixture proof: strict vs inclusive boundary and around never passes',
  );
  ledger.recordAssertion(
    RUN_ID,
    'P2:unknown-price-null-total-fixture',
    (() => {
      const total = pairTotal([
        { price: 120, quantity: 1 },
        { price: null, quantity: 1 },
      ]);
      return total.totalCents === null && total.unknownCount === 1;
    })()
      ? 'pass'
      : 'fail',
    'fixture proof: unknown price yields null total and counted unknowns, never a guess',
  );
  ledger.recordAssertion(
    RUN_ID,
    'P2:add-cents-null-fixture',
    addCents(100, null) === null ? 'pass' : 'fail',
    'fixture proof: subtotal addition propagates unknowns',
  );

  // ---- L03 anchor preservation validator (pure, fixture evidence)
  const lookEvidence: PresentationEvidence[] = ['LOOKFIX-1', 'LOOKFIX-2', 'LOOKFIX-3'].map(
    (objectID) => ({
      source: 'prod_catalog' as const,
      objectID,
      contentHash: `hash-${objectID}`,
      retrievedAt: '2026-10-07T00:00:00.000Z',
      evidenceRef: `prod_catalog/${objectID}/hash-${objectID}`,
      record: {
        Catalog_TitleDescription: `Fixture look piece ${objectID}`,
        Pricing_ActivePrice: 100,
      },
      missionId: 'stage6-looks-mission',
      stateRevision: 1,
      evidenceBatchRevision: 1,
      turnId: 't1',
      contentsVerified: true,
    }),
  );
  const lookContext: PresentationContext = {
    missionId: 'stage6-looks-mission',
    stateRevision: 1,
    evidenceBatchRevision: 1,
    turnId: 't1',
    evidence: lookEvidence,
    acceptedAnchorIds: ['LOOKFIX-1'],
  };
  const lookLine = (objectID: string, componentSlot: string) => ({
    evidenceRef: `prod_catalog/${objectID}/hash-${objectID}`,
    objectID,
    contentHash: `hash-${objectID}`,
    quantity: 1,
    componentSlot,
    explanation: 'fixture look line',
  });
  const missingAnchorResult = presentChoices(
    {
      missionId: 'stage6-looks-mission',
      expectedStateRevision: 1,
      expectedEvidenceBatchRevision: 1,
      turnId: 't1',
      proposalId: 'p1',
      body: {
        kind: 'complete_looks',
        groups: null,
        alternatives: [
          { title: 'Look without the accepted anchor', lines: [lookLine('LOOKFIX-2', 'companion')] },
        ],
      },
    },
    lookContext,
  );
  ledger.recordAssertion(
    RUN_ID,
    'L03:missing-anchor-rejected-fixture',
    missingAnchorResult.status === 'invalid_input' &&
      missingAnchorResult.reasons.includes('missing_accepted_anchor')
      ? 'pass'
      : 'fail',
    `fixture proof: a look alternative omitting the accepted anchor is rejected, status ${missingAnchorResult.status}`,
  );
  const duplicateSlotResult = presentChoices(
    {
      missionId: 'stage6-looks-mission',
      expectedStateRevision: 1,
      expectedEvidenceBatchRevision: 1,
      turnId: 't1',
      proposalId: 'p2',
      body: {
        kind: 'complete_looks',
        groups: null,
        alternatives: [
          {
            title: 'Look with a duplicated slot',
            lines: [lookLine('LOOKFIX-1', 'anchor'), lookLine('LOOKFIX-2', 'anchor')],
          },
        ],
      },
    },
    lookContext,
  );
  ledger.recordAssertion(
    RUN_ID,
    'L03:duplicate-component-slot-rejected-fixture',
    duplicateSlotResult.status === 'invalid_input' &&
      duplicateSlotResult.reasons.includes('duplicate_component_slot')
      ? 'pass'
      : 'fail',
    `fixture proof: two lines in one alternative claiming the same component slot are rejected, status ${duplicateSlotResult.status}`,
  );

  // ---- Connected-only positives stay blocked, never pass
  ledger.recordAssertion(RUN_ID, 'E07:agent-applies-remaining-budget', 'blocked', BLOCKERS.connectedRun);
  ledger.recordAssertion(RUN_ID, 'E08:corrected-replacement-turn', 'blocked', BLOCKERS.claude1C4);
  ledger.recordAssertion(RUN_ID, 'E10:agent-discloses-unknown', 'blocked', BLOCKERS.connectedRun);
  ledger.recordAssertion(RUN_ID, 'E11:honest-infeasible-reply', 'blocked', BLOCKERS.connectedRun);
  ledger.recordAssertion(RUN_ID, 'E13:conflict-claim-withholding', 'blocked', BLOCKERS.connectedRun);
  ledger.recordAssertion(RUN_ID, 'E15:connected-refresh-rehydration', 'blocked', BLOCKERS.dev2Stage5);
  ledger.recordAssertion(RUN_ID, 'E17:or-exclusion-connected-turn', 'blocked', BLOCKERS.claude1C4);
  ledger.recordAssertion(RUN_ID, 'E24:native-adverse-injection', 'blocked', BLOCKERS.connectedRun);
  ledger.recordAssertion(RUN_ID, 'E25:scoped-rejection-stop', 'blocked', BLOCKERS.connectedRun);
  ledger.recordAssertion(RUN_ID, 'E26:selection-preservation-connected', 'blocked', BLOCKERS.connectedRun);

  // ---- Paid-call guard: an unstubbed upstream must fail the test, not spend
  expect(paidUrls, 'no request may reach Algolia Agent Studio or a paid endpoint').toEqual([]);

  // ---- Ledger artifact and gate
  const recorded = ledger.assertions(RUN_ID) as Record<string, { status: string; detail: string }>;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const ledgerPath = path.join(SCREENSHOT_DIR, `ledger-${projectName}.json`);
  writeFileSync(
    ledgerPath,
    JSON.stringify({ totals: ledger.totals(), assertions: recorded, screenshots }, null, 2),
  );
  await testInfo.attach('stage6-looks-ledger.json', {
    body: JSON.stringify(
      { totals: ledger.totals(), assertions: recorded, screenshots },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(
    Object.values(recorded).some((entry) => entry.status === 'fail'),
    'no assertion may fail in the offline suite',
  ).toBe(false);
  expect(
    Object.values(recorded).some((entry) => entry.status === 'pass'),
    'the suite must actually assert, never record only blocked entries',
  ).toBe(true);
  for (const [id, entry] of Object.entries(recorded)) {
    if (entry.status === 'blocked') {
      expect(
        /B[123]:/.test(entry.detail),
        `blocked assertion ${id} must name its blocker: ${entry.detail}`,
      ).toBe(true);
    }
  }
});
