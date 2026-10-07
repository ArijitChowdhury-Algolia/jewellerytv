import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Bounded C4 material-colour exclusion correction (opt-in, one paid turn).
// Invocation: JTV_RUN_C4_EXCLUSION_VERIFY=1 npx playwright test --config evaluation/concierge-phases-1-3/c4-exclusion-verify.config.ts
// Verifies, from raw receipts only:
//   1. the accepted brief carries a typed exclusion fact (exclusion facet,
//      Catalog_MaterialInformation.MaterialColor, Yellow, operator none,
//      requirement, explicit),
//   2. no retrieved prod_catalog record with a Yellow material entry survives
//      verification, and material-less records are counted as unknown,
//   3. no presented card matches a record that carries a Yellow entry,
//   4. the generated reply renders and contains no em dash.
// Arijit's accepted interpretation: strict exclusion, so any Yellow material
// entry, including two-tone construction, is excluded.

const live = process.env.JTV_RUN_C4_EXCLUSION_VERIFY === '1';

// A fresh self-contained phrasing that encodes category, material alternatives
// and the exclusion in one turn; distinct from the C4 smoke's correction wording.
const question =
  process.env.JTV_C4_QUESTION ??
  'For our tenth anniversary I want a necklace for my wife, white gold or sterling silver please, and definitely not yellow gold. Budget is under $250.';

const completionBudget = 8;

test('C4 correction turn encodes the typed exclusion and excludes yellow-entry records', async ({
  page,
}) => {
  test.skip(!live, 'Paid connected verification is opt-in (JTV_RUN_C4_EXCLUSION_VERIFY=1).');
  const runDir = path.resolve(
    '..',
    '.checkpoint',
    'runs',
    `c4-exclusion-verify-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  fs.mkdirSync(runDir, { recursive: true });
  const startedAt = Date.now();

  const evidenceCalls: Array<{ requestBody: unknown; responseBody: unknown }> = [];
  let completionRequests = 0;
  const blockedUrls: string[] = [];

  await page.route('**/api/chat', async (route) => {
    completionRequests += 1;
    if (completionRequests > completionBudget) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.route('**/api/agent-evidence', async (route) => {
    const requestBody = route.request().postDataJSON();
    const response = await route.fetch();
    let responseBody: unknown = { unreadable: true };
    try {
      responseBody = await response.json();
    } catch {
      /* keep unreadable marker */
    }
    evidenceCalls.push({ requestBody, responseBody });
    await route.fulfill({ response });
  });
  // Global stop conditions: no production agent, no index mutation or settings endpoint.
  page.on('request', (request) => {
    const url = request.url();
    if (
      /\/api\/chat|\/api\/agent-evidence|localhost|127\.0\.0\.1|fonts|favicon|images\.jtv\.com|www\.jtv\.com|\.css|\.js|\.png|\.svg|\.woff/.test(
        url,
      )
    )
      return;
    blockedUrls.push(url);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
  await expect(input).toBeVisible();

  await input.fill(question);
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(input).toBeDisabled();
  await expect(input).toBeEnabled({ timeout: 180_000 });

  const reply = panel.locator('.connected-assistant-message').last();
  await expect(reply).toBeVisible();
  const replyText = (await reply.textContent()) ?? '';

  // Workspace cards visible this turn, using the proven Stage 2 selectors:
  // the workspace is the 'Shopping choices' region; Discover cards are
  // article.pw-product with data-product-id (ProductWorkspace.tsx line 334).
  const workspace = panel.getByRole('region', { name: 'Shopping choices' });
  const cardIds = await workspace
    .locator('.pw-discover .pw-product')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-product-id') ?? '').filter((id) => id.length > 0),
    );
  const cardTitles = await workspace
    .locator('.pw-discover .pw-product')
    .evaluateAll((nodes) =>
      nodes.map((n) => (n.textContent ?? '').slice(0, 220)).filter((t) => t.trim().length > 0),
    );

  // Agent/config identity receipt: served health endpoint plus the captured chat bodies.
  let healthReceipt: unknown = { unreadable: true };
  try {
    const health = await page.request.get('http://localhost:5173/api/health');
    healthReceipt = await health.json();
  } catch {
    /* keep unreadable marker */
  }

  // Screenshots at consequential moments (standing validation instruction).
  await page.screenshot({ path: path.join(runDir, 'after-reply-viewport.png'), fullPage: false });
  await page.screenshot({ path: path.join(runDir, 'after-reply-full.png'), fullPage: true });
  await panel.screenshot({ path: path.join(runDir, 'conversation-pane.png') });
  await workspace.screenshot({ path: path.join(runDir, 'workspace-discover.png') });

  // Collect brief facts from evidence request bodies (the evidence call embeds the brief)
  // and records from response bodies, unwrapping the envelope's nested record.
  type Fact = {
    field?: string;
    value?: { kind?: string; attribute?: string; values?: string[]; operator?: string };
    strength?: string;
    certainty?: string;
    scope?: { kind?: string };
    status?: string;
  };
  const briefFacts: Fact[] = [];
  type RecordEnvelope = {
    status?: string;
    source?: string;
    records?: Array<{
      source?: string;
      contentHash?: string;
      objectID?: string;
      record?: {
        Catalog_MaterialInformation?: Array<{
          MaterialColor?: string;
          MaterialType?: string;
        }>;
        Catalog_TitleDescription?: string;
      };
    }>;
  };
  const retrieved: Array<{
    objectID: string;
    title: string;
    hasYellow: boolean;
    hasMaterialData: boolean;
  }> = [];
  for (const call of evidenceCalls) {
    const req = call.requestBody as { brief?: { facts?: Fact[] } } | null;
    for (const fact of req?.brief?.facts ?? []) briefFacts.push(fact);
    const res = call.responseBody as RecordEnvelope;
    if (res?.status !== 'ok' || res?.source !== 'prod_catalog') continue;
    for (const envelope of res.records ?? []) {
      const record = envelope.record ?? (envelope as RecordEnvelope['records'] extends undefined ? never : RecordEnvelope['records'] extends (infer R)[] ? R extends { record?: infer R2 } ? R2 : never : never);
      const materials = record?.Catalog_MaterialInformation ?? [];
      const colors = materials.map((m) => m.MaterialColor).filter((c): c is string => !!c);
      retrieved.push({
        objectID: envelope.objectID ?? 'unknown',
        title: record?.Catalog_TitleDescription ?? '',
        hasYellow: colors.includes('Yellow'),
        hasMaterialData: materials.length > 0,
      });
    }
  }

  // Card-level mechanical check (independent-review condition 2): every
  // presented card's matched retrieved record must carry no Yellow entry.
  // A card with no matching captured record is recorded as unverifiable.
  const yellowCards = cardIds
    .map((id) => ({ id, record: retrieved.find((record) => record.objectID === id) }))
    .filter((card) => card.record?.hasYellow);
  const unmatchedCards = cardIds.filter((id) => !retrieved.some((record) => record.objectID === id));

  const exclusionFacts = briefFacts.filter(
    (fact) =>
      fact.field === 'exclusion' &&
      fact.value?.kind === 'facet' &&
      fact.value.attribute === 'Catalog_MaterialInformation.MaterialColor' &&
      (fact.value.values ?? []).includes('Yellow') &&
      fact.value.operator === 'none',
  );

  const yellowRetrieved = retrieved.filter((record) => record.hasYellow);
  const materiallessRetrieved = retrieved.filter((record) => !record.hasMaterialData);

  const result = {
    question,
    replyText,
    cardTitles,
    cardIds,
    yellowCards,
    unmatchedCards,
    healthReceipt,
    briefFactCount: briefFacts.length,
    exclusionFacts,
    retrievedRecords: retrieved,
    yellowRetrieved,
    materiallessRetrieved,
    evidenceCalls: evidenceCalls.length,
    completionRequests,
    blockedUrls,
    elapsedMs: Date.now() - startedAt,
    at: new Date().toISOString(),
    verdict:
      completionRequests > completionBudget
        ? 'fail: completion stop condition exceeded'
        : blockedUrls.length > 0
          ? 'fail: request outside local allowlist observed'
          : yellowCards.length > 0
            ? 'fail: a presented card matches a retrieved record carrying a Yellow entry'
            : exclusionFacts.length === 0
            ? 'fail: no typed material-colour exclusion fact in the accepted brief'
            : yellowRetrieved.length > 0
              ? 'fail: retrieved record carries a Yellow material entry'
              : materiallessRetrieved.length > 0
                ? 'unknown: material-less records returned; exclusion unverifiable on them'
                : retrieved.length === 0
                  ? 'unknown: no prod_catalog records retrieved this turn'
                  : replyText.length === 0
                    ? 'fail: no reply rendered'
                    : replyText.includes('—')
                      ? 'fail: em dash in generated reply'
                      : 'pass: typed exclusion fact present and no yellow-entry record retrieved',
  };
  fs.writeFileSync(
    path.join(runDir, 'result.json'),
    JSON.stringify({ ...result, evidenceCalls }, null, 2),
  );
  console.log('C4-EXCLUSION-RESULT', JSON.stringify(result, null, 2));

  expect(completionRequests).toBeLessThanOrEqual(completionBudget);
  expect(blockedUrls, 'all requests stay on the local allowlist').toEqual([]);
  expect(
    exclusionFacts.length,
    'the accepted brief must carry the typed material-colour exclusion fact',
  ).toBeGreaterThan(0);
  expect(
    yellowRetrieved,
    'no retrieved record may carry a Yellow material entry (strict rule, two-tone included)',
  ).toEqual([]);
  expect(
    yellowCards,
    'no presented card may match a retrieved record carrying a Yellow entry',
  ).toEqual([]);
  expect(retrieved.length, 'the turn should retrieve candidate products').toBeGreaterThan(0);
});
