import { expect, test, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

/*
 * Father Vienna identity-mismatch fixture reproduction (read-only, no paid
 * completions). Establishes the UI half of the causal chain for the preserved
 * incident (../.checkpoint/runs/person-first-after-2026-10-07T07-32-49-358Z/
 * father-variant.png): a card whose identity fields came from PPR7845 while the
 * why-line prose carried sibling record JRK001's facts.
 *
 * The app half under test: ProductWorkspace renders each Discover card's
 * title/price/stock strictly from that card's own evidence-bound record, and
 * the model-authored explanation lands verbatim in the why slot. A blended
 * explanation must therefore produce a blended PROSE line while identity
 * fields stay per-record - the app cannot itself fuse two records into one
 * card (see also the identity gates in shared/concierge/presentation.ts and
 * src/workspaceResults.ts).
 */

const baseUrl = process.env.JTV_VIENNA_BASE_URL ?? 'http://localhost:5173';
const runDir = path.resolve(
  process.cwd(),
  '..',
  '.checkpoint',
  'runs',
  `father-vienna-identity-fixture-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

// Exact current record shapes (../.checkpoint/runs/father-watch-identity-audit-
// 2026-10-07/current-exact-records.json, read-only GET receipts).
const PPR7845 = {
  objectID: 'PPR7845',
  Catalog_TitleDescription:
    'Pre-Owned Judith Ripka Couture Vienna White Diamond Accent With Orange Leather Strap Watch 0.03ctw',
  Pricing_ActivePrice: 458.99,
  Catalog_Condition: 'Pre-Owned',
  Inventory_InStock: true,
  Catalog_ProductType: 'Wrist Watch',
};
const JRK001 = {
  objectID: 'JRK001',
  Catalog_TitleDescription:
    'Judith Ripka Couture Vienna White Diamond Accent With Orange Leather Strap Watch 0.03ctw',
  Pricing_ActivePrice: 267.4,
  Catalog_Condition: 'First Quality',
  Inventory_InStock: false,
  Catalog_ProductType: 'Wrist Watch',
};
// The incident's blended why-line: JRK001 facts on the PPR7845 card.
const BLENDED_EXPLANATION =
  'A first quality Vienna watch with orange leather strap, currently out of stock.';

test('fixture: blended explanation cannot blend card identity fields', async () => {
  await fs.mkdir(runDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const receipt: {
    at: string;
    assertions: string[];
    status?: string;
    error?: string;
  } = { at: new Date().toISOString(), assertions: [] };
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ ppr, jrk, blended }) => {
        const reactModule = '/node_modules/.vite/deps/react.js';
        const reactDomModule = '/node_modules/.vite/deps/react-dom_client.js';
        const container = document.createElement('main');
        container.id = 'vienna-identity-fixture';
        document.body.append(container);
        return (async () => {
          await import('/src/styles.css');
          const ReactModule = await import(reactModule);
          const React = ReactModule.default;
          const { createRoot } = (await import(reactDomModule)).default;
          // Vite runtime imports; variables so TypeScript does not resolve
          // the literal dev-server paths.
          const pwPath = '/src/ProductWorkspace.tsx';
          const catalogPath = '/src/catalog/index.ts';
          const { ProductWorkspace } = (await import(/* @vite-ignore */ pwPath)) as {
            ProductWorkspace: React.ComponentType<{ model: unknown }>;
          };
          const { normalizeProduct } = (await import(/* @vite-ignore */ catalogPath)) as {
            normalizeProduct: (raw: unknown) => { id: string };
          };
          const byId = new Map<string, unknown>([
            [ppr.objectID, ppr],
            [jrk.objectID, jrk],
          ]);
          // Hydrate exactly like workspaceGroups: product from the record the
          // objectID names; explanation passed through verbatim.
          const product = (id: string) => normalizeProduct(byId.get(id));
          const model = {
            products: [],
            selectionRecords: [],
            discoveries: [
              {
                title: 'Vienna watches',
                items: [
                  {
                    product: product(ppr.objectID),
                    // The incident's blend: PPR7845's card carrying JRK001 facts.
                    why: blended,
                    assessment: 'compliant' as const,
                  },
                  {
                    product: product(jrk.objectID),
                    why: 'The first quality version of the same Vienna watch.',
                    assessment: 'unknown' as const,
                  },
                ],
              },
            ],
            activeView: 'discover' as const,
            setView: () => undefined,
            compareIds: [],
            combinationIds: [],
            combinationQuantities: {},
            toggleCompare: () => undefined,
            toggleCombination: () => undefined,
            pin: () => undefined,
            remove: () => undefined,
            setQuantity: () => undefined,
            refreshProducts: async () => undefined,
            refreshing: false,
            refreshError: '',
            budgetCents: null,
            budgetScope: 'total' as const,
          };
          const root = createRoot(container);
          root.render(React.createElement(ProductWorkspace, { model }));
          await new Promise((resolve) => setTimeout(resolve, 300));
        })();
      },
      { ppr: PPR7845, jrk: JRK001, blended: BLENDED_EXPLANATION },
    );
    const cards = page.locator('#vienna-identity-fixture article.pw-product');
    await expect(cards).toHaveCount(2);
    const pprCard = cards.filter({ hasText: 'Pre-Owned Judith Ripka' });
    const jrkCard = cards
      .filter({ hasText: 'Judith Ripka Couture Vienna' })
      .filter({ hasNotText: 'Pre-Owned' });
    await expect(pprCard).toHaveCount(1);
    await expect(jrkCard).toHaveCount(1);

    // Identity fields of the PPR7845 card stay its own record's facts.
    await expect(pprCard.getByText('$458.99')).toHaveCount(1);
    await expect(pprCard.getByText('Listed in stock')).toHaveCount(1);
    // The blended prose renders verbatim in the why slot - the only free-text
    // channel - while identity fields above it are untouched.
    await expect(pprCard.getByText(BLENDED_EXPLANATION)).toHaveCount(1);

    // The JRK001 card renders its own record's facts, including the
    // unavailable badge the blended prose wrongly claimed for its sibling.
    await expect(jrkCard.getByText('$267.40')).toHaveCount(1);
    await expect(jrkCard.getByText('Listed unavailable')).toHaveCount(1);

    // No card shows the sibling's price.
    await expect(pprCard.getByText('$267.40')).toHaveCount(0);
    await expect(jrkCard.getByText('$458.99')).toHaveCount(0);

    receipt.assertions.push(
      'ppr-card-identity-per-record',
      'blended-prose-verbatim-in-why',
      'jrk-card-identity-per-record',
      'no-cross-record-price',
    );
    await page.screenshot({
      path: path.join(runDir, 'vienna-identity-fixture.png'),
      fullPage: true,
    });
    receipt.status = 'pass';
  } catch (error) {
    receipt.status = 'fail';
    receipt.error = String(error);
    await page
      .screenshot({ path: path.join(runDir, 'vienna-identity-fixture-fail.png'), fullPage: true })
      .catch(() => undefined);
    throw error;
  } finally {
    await fs.writeFile(path.join(runDir, 'result.json'), JSON.stringify(receipt, null, 2));
    await browser.close();
  }
});
