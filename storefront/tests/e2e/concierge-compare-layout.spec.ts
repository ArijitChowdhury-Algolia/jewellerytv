import { expect, test } from '@playwright/test';
import { createBriefStateV3 } from '../../shared/briefState.js';
import { V3_SESSION_KEY } from '../../src/concierge/sessionPersistence.js';

const missionId = 'compare-layout-mission';
const records = [
  {
    objectID: 'CHAIN-A',
    Catalog_TitleDescription: '14k White Gold 0.8mm Polished Baby Rope Chain, 24 inches',
    Catalog_ProductType: 'Necklace',
    Catalog_Brand: 'JTV Collection',
    Catalog_JewelryMaterialNavigationName: ['Gold'],
    Catalog_JewelryMaterialNavigationPurity: ['14K'],
    Catalog_JewelryMaterialNavigationColor: ['White'],
    Pricing_ActivePrice: 350.38,
    Media_Images: ['https://fixture.test/compare-image/landscape.svg'],
  },
  {
    objectID: 'CHAIN-B',
    Catalog_TitleDescription:
      '14k White Gold 0.95mm Solid Diamond-Cut Cable Chain Necklace, Twenty Inches',
    Catalog_ProductType: 'Necklace',
    Catalog_JewelryMaterialNavigationName: ['Gold'],
    Catalog_JewelryMaterialNavigationPurity: ['14K'],
    Catalog_JewelryMaterialNavigationColor: ['White'],
    Pricing_ActivePrice: 473.53,
    Media_Images: ['https://fixture.test/compare-image/portrait.svg'],
  },
];
const session = {
  version: 3 as const,
  missionId,
  brief: createBriefStateV3(missionId),
  products: [],
  selectionRecords: records.map((record) => ({
    sourceIndex: 'prod_catalog' as const,
    objectID: record.objectID,
    raw: record,
    quantity: 1,
    observedAt: null,
    binding: 'evidence_bound' as const,
    contentHash: `hash-${record.objectID}`,
    evidenceRef: `prod_catalog/${record.objectID}/hash-${record.objectID}`,
  })),
  compareIds: records.map((record) => record.objectID),
  activeView: 'compare' as const,
  receipts: [],
  evidence: [],
};

test('Compare aligns unequal product titles and facts at responsive widths', async ({
  browser,
}, testInfo) => {
  for (const width of [375, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(
      ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
      { key: V3_SESSION_KEY, value: session },
    );
    await page.route('**/api/search', async (route) => {
      const body = route.request().postDataJSON() as {
        requests?: Array<{ params?: { query?: string } }>;
      };
      await route.fulfill({
        json: {
          results: (body.requests ?? []).map((request) => ({
            hits: [],
            nbHits: 0,
            nbPages: 0,
            page: 0,
            hitsPerPage: 24,
            processingTimeMS: 0,
            query: request.params?.query ?? '',
            exhaustiveNbHits: true,
            facets: {},
            facets_stats: {},
            renderingContent: {},
          })),
        },
      });
    });
    await page.route('**/api/chat', (route) =>
      route.fulfill({ status: 500, json: { error: 'Chat disabled in Compare layout test' } }),
    );
    await page.route('https://fixture.test/compare-image/**', (route) => {
      const portrait = route.request().url().endsWith('/portrait.svg');
      const [imageWidth, imageHeight] = portrait ? [552, 737] : [737, 552];
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}"><rect width="100%" height="100%" fill="white"/><path d="M 60 35 C 60 ${imageHeight - 50}, ${imageWidth - 60} ${imageHeight - 50}, ${imageWidth - 60} 35" fill="none" stroke="#9da5aa" stroke-width="8"/></svg>`,
      });
    });

    try {
      await page.goto('/');
      await page.getByRole('button', { name: /open jewelry concierge/i }).click();
      const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
      if (width < 768) await panel.getByRole('button', { name: /^Products/ }).click();
      const comparison = panel.locator('.pw-comparison[data-view="compare"]');
      await expect(comparison.locator('.pw-compare-product[data-product-id]')).toHaveCount(2);
      await expect(comparison.locator('[data-product-id="CHAIN-A"]')).toBeVisible();
      await expect(comparison.locator('[data-product-id="CHAIN-B"]')).toBeVisible();
      await expect
        .poll(() =>
          comparison
            .locator('.pw-compare-image img')
            .evaluateAll((images) =>
              images.map((image) => (image as HTMLImageElement).naturalWidth > 0),
            ),
        )
        .toEqual([true, true]);

      const geometry = await comparison.evaluate((element) => {
        const cards = [...element.querySelectorAll<HTMLElement>('.pw-compare-product')];
        const rect = (selector: string, card: HTMLElement) => {
          const node = card.querySelector<HTMLElement>(selector);
          const box = node?.getBoundingClientRect();
          return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
        };
        return cards.map((card) => ({
          id: card.dataset.productId,
          image: rect('.pw-compare-image .pw-image', card),
          media: rect('.pw-compare-image .pw-image img', card),
          title: rect(':scope > h3', card),
          price: rect(':scope > .pw-price', card),
          attributes: [...card.querySelectorAll<HTMLElement>('.pw-compare-attributes > div')].map(
            (row) => {
              const box = row.getBoundingClientRect();
              return { y: box.y, height: box.height };
            },
          ),
          actions: rect('.pw-compare-actions', card),
        }));
      });

      expect(geometry).toHaveLength(2);
      for (const card of geometry) {
        expect(card.image?.height).toBeGreaterThanOrEqual(120);
        expect(card.image?.height).toBeLessThanOrEqual(220);
        expect(card.media?.height).toBeLessThanOrEqual((card.image?.height ?? 0) + 1);
        expect(card.media?.width).toBeLessThanOrEqual((card.image?.width ?? 0) + 1);
        expect(card.media?.x).toBeGreaterThanOrEqual((card.image?.x ?? 0) - 1);
        expect(card.media?.y).toBeGreaterThanOrEqual((card.image?.y ?? 0) - 1);
        expect((card.media?.x ?? 0) + (card.media?.width ?? 0)).toBeLessThanOrEqual(
          (card.image?.x ?? 0) + (card.image?.width ?? 0) + 1,
        );
        expect((card.media?.y ?? 0) + (card.media?.height ?? 0)).toBeLessThanOrEqual(
          (card.image?.y ?? 0) + (card.image?.height ?? 0) + 1,
        );
        expect(card.title?.width).toBeGreaterThan(0);
        expect(card.actions?.height).toBeGreaterThan(0);
      }
      const aligned = (left: number | undefined, right: number | undefined) =>
        expect(Math.abs((left ?? 0) - (right ?? 0)), JSON.stringify(geometry)).toBeLessThanOrEqual(
          1,
        );
      aligned(geometry[0].title?.y, geometry[1].title?.y);
      aligned(geometry[0].price?.y, geometry[1].price?.y);
      aligned(geometry[0].actions?.y, geometry[1].actions?.y);
      expect(geometry[0].attributes).toHaveLength(5);
      expect(geometry[1].attributes).toHaveLength(5);
      for (let row = 0; row < geometry[0].attributes.length; row += 1) {
        aligned(geometry[0].attributes[row].y, geometry[1].attributes[row].y);
      }
      const facts = await comparison
        .locator('.pw-compare-product')
        .first()
        .locator('.pw-compare-attributes > div')
        .evaluateAll((rows) =>
          rows.map((row) => ({
            label: row.querySelector('dt')?.textContent?.trim(),
            value: row.querySelector('dd')?.textContent?.trim(),
          })),
        );
      expect(facts.map((fact) => fact.label)).toEqual([
        'Brand',
        'Product type',
        'Material',
        'Material purity',
        'Material color',
      ]);
      expect(facts.find((fact) => fact.label === 'Brand')?.value).toBe('JTV Collection');
      const secondFacts = await comparison
        .locator('.pw-compare-product')
        .nth(1)
        .locator('.pw-compare-attributes > div')
        .evaluateAll((rows) =>
          rows.map((row) => ({
            label: row.querySelector('dt')?.textContent?.trim(),
            value: row.querySelector('dd')?.textContent?.trim(),
          })),
        );
      expect(secondFacts.find((fact) => fact.label === 'Brand')?.value).toBe('Not recorded');
      expect(facts.some((fact) => fact.label?.startsWith('Gemstone'))).toBe(false);
      await testInfo.attach(`compare-${width}px.json`, {
        body: Buffer.from(JSON.stringify({ width, geometry }, null, 2)),
        contentType: 'application/json',
      });
      await testInfo.attach(`compare-${width}px.png`, {
        body: await page.screenshot({ path: testInfo.outputPath(`compare-${width}px.png`) }),
        contentType: 'image/png',
      });
      if (width === 375) {
        const documentOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(documentOverflow).toBeLessThanOrEqual(1);
      }

      await expect(comparison.getByText('Not recorded', { exact: true })).toBeVisible();
      await expect(comparison.getByRole('button', { name: /remove from comparison/i })).toHaveCount(
        2,
      );
    } finally {
      await context.close();
    }
  }
});
