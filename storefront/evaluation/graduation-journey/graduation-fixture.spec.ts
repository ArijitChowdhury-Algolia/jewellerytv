import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Synthetic session data exercises the workspace UI only. It is not catalogue
// evidence and this fixture cannot pass connected graduation acceptance.

const missionId = 'graduation-fixture-mission';
const necklaceId = 'GRAD-FIXTURE-NECKLACE';
const earringsId = 'GRAD-FIXTURE-EARRINGS';
const syntheticProducts = [
  {
    objectID: necklaceId,
    Catalog_ProductType: 'Necklace',
    Catalog_TitleDescription: 'Synthetic graduation necklace',
    Catalog_LongDescription: 'Synthetic UI fixture record. Not a real product listing.',
    Pricing_ActivePrice: 89.99,
    Inventory_InStock: true,
  },
  {
    objectID: earringsId,
    Catalog_ProductType: 'Earrings',
    Catalog_TitleDescription: 'Synthetic graduation earrings',
    Catalog_LongDescription: 'Synthetic UI fixture record. Not a real product listing.',
    Pricing_ActivePrice: 39.99,
    Inventory_InStock: true,
  },
];
const fixtureSession = {
  version: 3,
  missionId,
  brief: {
    version: 3,
    missionId,
    revision: 0,
    facts: [],
    processedTurns: [],
    tombstones: [],
    events: [],
  },
  products: syntheticProducts.map((raw) => ({
    sourceIndex: 'prod_catalog',
    objectID: raw.objectID,
    binding: 'legacy_unbound',
    contentHash: null,
    evidenceRef: null,
    raw,
    quantity: 1,
    observedAt: null,
  })),
  selectionRecords: [],
  compareIds: [],
  combinationIds: [],
  combinationQuantities: {},
  activeView: 'saved',
  receipts: [],
};

test('graduation fixture uses Saved, Compare, and Combination without chat', async ({
  browser,
}, testInfo) => {
  const runDir = testInfo.outputDir;
  fs.mkdirSync(runDir, { recursive: true });
  const context = await browser.newContext();
  await context.addInitScript((session) => {
    sessionStorage.setItem('jtv.shopping.v3', JSON.stringify(session));
  }, fixtureSession);
  const page = await context.newPage();
  let chatCalls = 0;
  await page.route('**/api/chat', async (route) => {
    chatCalls += 1;
    await route.abort();
  });

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    const workspace = panel.getByRole('region', { name: 'Shopping choices' });
    const nav = workspace.getByRole('navigation', { name: 'Product views' });

    await expect(nav.getByRole('button', { name: 'Saved (2)' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const savedNecklace = workspace.locator(
      `.pw-saved .pw-product[data-product-id="${necklaceId}"]`,
    );
    const savedEarrings = workspace.locator(
      `.pw-saved .pw-product[data-product-id="${earringsId}"]`,
    );
    await expect(savedNecklace).toBeVisible();
    await expect(savedEarrings).toBeVisible();

    await savedNecklace.getByRole('button', { name: 'Compare', exact: true }).click();
    await savedEarrings.getByRole('button', { name: 'Compare', exact: true }).click();
    await nav.getByRole('button', { name: 'Compare (2)' }).click();
    await expect(
      workspace.locator(`.pw-comparison .pw-compare-product[data-product-id="${necklaceId}"]`),
    ).toBeVisible();
    await expect(
      workspace.locator(`.pw-comparison .pw-compare-product[data-product-id="${earringsId}"]`),
    ).toBeVisible();

    await nav.getByRole('button', { name: 'Saved (2)' }).click();
    await savedNecklace.getByRole('button', { name: 'Add to combination' }).click();
    await savedEarrings.getByRole('button', { name: 'Add to combination' }).click();
    await nav.getByRole('button', { name: 'Combination (2)' }).click();
    const combinationItems = workspace.locator('.pw-comparison .pw-compare-product');
    await expect(combinationItems).toHaveCount(2);
    await expect(
      workspace.locator(`.pw-comparison .pw-compare-product[data-product-id="${necklaceId}"]`),
    ).toBeVisible();
    await expect(
      workspace.locator(`.pw-comparison .pw-compare-product[data-product-id="${earringsId}"]`),
    ).toBeVisible();
    await workspace.screenshot({ path: path.join(runDir, 'graduation-combination-fixture.png') });

    expect(chatCalls).toBe(0);
    fs.writeFileSync(
      path.join(runDir, 'result.json'),
      JSON.stringify(
        {
          mode: 'fixture-only-no-chat',
          scenario: 'synthetic graduation necklace and earrings',
          productIds: [necklaceId, earringsId],
          exercisedControls: ['Saved', 'Compare', 'Combination'],
          chatCalls,
          connectedAcceptance: 'not evaluated',
          outcome: 'pass',
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
