import { expect, test } from '@playwright/test';
import { createBriefStateV3 } from '../../shared/briefState.js';
import { V3_SESSION_KEY } from '../../src/concierge/sessionPersistence.js';

const missionId = 'saved-downselection-mission';
const records = Array.from({ length: 6 }, (_, index) => {
  const objectID = `SAVED-${index + 1}`;
  return {
    objectID,
    Catalog_TitleDescription: `Sterling silver diamond-cut chain necklace with a detailed clasp and extended description ${index + 1}`,
    Pricing_ActivePrice: 45 + index * 5,
    Media_Images: [],
  };
});
const boundRecords = records.map((record) => {
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
  missionId,
  brief: createBriefStateV3(missionId),
  products: boundRecords,
  selectionRecords: boundRecords,
  compareIds: [],
  combinationIds: [],
  combinationQuantities: {},
  activeView: 'saved' as const,
  receipts: [],
  evidence: boundRecords.map((record) => ({
    evidenceRef: record.evidenceRef,
    sourceIndex: 'prod_catalog' as const,
    objectID: record.objectID,
    contentHash: record.contentHash,
  })),
};

test('six saved pieces can be compared, narrowed, and restored without deleting saves', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  for (const width of [1440, 1024, 768, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const exactRefreshes: string[][] = [];
    await page.addInitScript(
      ({ key, seedKey, value }) => {
        if (sessionStorage.getItem(seedKey) === 'done') return;
        sessionStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem(seedKey, 'done');
      },
      { key: V3_SESSION_KEY, seedKey: 'jtv-test-saved-downselection-seeded', value: session },
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
      route.fulfill({ status: 500, json: { error: 'Chat disabled in Saved/Compare test' } }),
    );
    await page.route('**/api/agent-product-refresh', async (route) => {
      const body = route.request().postDataJSON() as {
        exactObjectIDs: string[];
        missionId: string;
        expectedRevision: number;
        turnId: string;
      };
      exactRefreshes.push(body.exactObjectIDs);
      const refreshedRecords = body.exactObjectIDs.map((id) => {
        const source = records.find((record) => record.objectID === id);
        if (!source) throw new Error(`Unexpected exact ID ${id}`);
        const contentHash = `fresh-${id}`;
        return {
          source: 'prod_catalog',
          objectID: id,
          contentHash,
          evidenceRef: `prod_catalog/${id}/${contentHash}`,
          retrievedAt: '2026-10-07T12:00:00.000Z',
          record: { ...source, Pricing_ActivePrice: source.Pricing_ActivePrice + 1 },
        };
      });
      await route.fulfill({
        json: {
          status: 'ok',
          source: 'prod_catalog',
          missionId: body.missionId,
          revision: body.expectedRevision,
          expectedRevision: body.expectedRevision,
          turnId: body.turnId,
          effectiveFilters: [],
          unresolved: [],
          records: refreshedRecords,
        },
      });
    });

    try {
      await page.goto('/');
      await page.getByRole('button', { name: /open jewelry concierge/i }).click();
      const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
      if (width < 768) await panel.getByRole('button', { name: /^Products/ }).click();
      const workspace = panel.getByRole('region', { name: 'Shopping choices' });
      const savedCards = workspace.locator('.pw-saved .pw-product[data-product-id]');
      await expect(savedCards).toHaveCount(6);
      const cardGeometry = await savedCards.evaluateAll((cards) =>
        cards.map((card) => {
          const box = (element: Element | null) => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width };
          };
          const title = card.querySelector('h3');
          const actions = card.querySelector('.pw-actions');
          return {
            card: box(card),
            title: box(title),
            titleScrollWidth: title?.scrollWidth ?? 0,
            titleClientWidth: title?.clientWidth ?? 0,
            actions: box(actions),
            actionsScrollWidth: actions?.scrollWidth ?? 0,
            actionsClientWidth: actions?.clientWidth ?? 0,
            buttons: [...(actions?.querySelectorAll('button') ?? [])].map((button) => ({
              ...box(button),
              label: button.textContent?.trim(),
            })),
          };
        }),
      );
      for (const geometry of cardGeometry) {
        expect(geometry.title).not.toBeNull();
        expect(geometry.actions).not.toBeNull();
        expect(geometry.titleScrollWidth).toBeLessThanOrEqual(geometry.titleClientWidth + 1);
        expect(geometry.actionsScrollWidth).toBeLessThanOrEqual(geometry.actionsClientWidth + 1);
        expect(geometry.title?.left).toBeGreaterThanOrEqual((geometry.card?.left ?? 0) - 1);
        expect(geometry.title?.right).toBeLessThanOrEqual((geometry.card?.right ?? 0) + 1);
        expect(geometry.actions?.left).toBeGreaterThanOrEqual((geometry.card?.left ?? 0) - 1);
        expect(geometry.actions?.right).toBeLessThanOrEqual((geometry.card?.right ?? 0) + 1);
        for (const button of geometry.buttons) {
          expect(button.left).toBeGreaterThanOrEqual((geometry.card?.left ?? 0) - 1);
          expect(button.right).toBeLessThanOrEqual((geometry.card?.right ?? 0) + 1);
        }
      }
      await expect(
        workspace.getByRole('navigation', { name: 'Product views' }).getByRole('button', {
          name: 'Saved (6)',
        }),
      ).toBeVisible();

      for (let index = 0; index < 3; index += 1) {
        await savedCards.nth(index).getByRole('button', { name: 'Compare', exact: true }).click();
      }
      await expect(
        workspace.getByRole('navigation', { name: 'Product views' }).getByRole('button', {
          name: 'Compare (3)',
        }),
      ).toBeVisible();
      await expect(
        savedCards.nth(3).getByRole('button', { name: 'Compare', exact: true }),
      ).toBeDisabled();

      await workspace
        .getByRole('navigation', { name: 'Product views' })
        .getByRole('button', { name: 'Compare (3)' })
        .click();
      await expect(workspace.locator('.pw-compare-product[data-product-id]')).toHaveCount(3);
      await expect(workspace.getByRole('status')).toBeHidden();
      expect(exactRefreshes[0]).toEqual(['SAVED-1', 'SAVED-2', 'SAVED-3']);

      await workspace
        .locator('.pw-compare-product[data-product-id="SAVED-2"]')
        .getByRole('button', { name: 'Remove from comparison' })
        .click();
      await workspace
        .locator('.pw-compare-product[data-product-id="SAVED-3"]')
        .getByRole('button', { name: 'Remove from comparison' })
        .click();
      await expect(workspace.locator('.pw-compare-product[data-product-id]')).toHaveCount(1);
      await expect(
        workspace.getByRole('navigation', { name: 'Product views' }).getByRole('button', {
          name: 'Compare (1)',
        }),
      ).toBeVisible();
      await expect(
        workspace.getByRole('navigation', { name: 'Product views' }).getByRole('button', {
          name: 'Saved (6)',
        }),
      ).toBeVisible();
      const beforeReload = await page.evaluate((key) => {
        const value = sessionStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      }, V3_SESSION_KEY);
      expect(beforeReload?.compareIds).toEqual(['SAVED-1']);
      expect(beforeReload?.activeView).toBe('compare');

      await page.reload();
      const immediatelyAfterReload = await page.evaluate((key) => {
        const value = sessionStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      }, V3_SESSION_KEY);
      expect(immediatelyAfterReload?.compareIds).toEqual(['SAVED-1']);
      expect(immediatelyAfterReload?.activeView).toBe('compare');
      await page.getByRole('button', { name: /open jewelry concierge/i }).click();
      const restored = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
      if (width < 768) await restored.getByRole('button', { name: /^Products/ }).click();
      const restoredWorkspace = restored.getByRole('region', { name: 'Shopping choices' });
      await expect(restoredWorkspace.locator('.pw-compare-product[data-product-id]')).toHaveCount(
        1,
      );
      await expect(
        restoredWorkspace
          .getByRole('navigation', { name: 'Product views' })
          .getByRole('button', { name: 'Saved (6)' }),
      ).toBeVisible();
      const restoredState = await page.evaluate((key) => {
        const value = sessionStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      }, V3_SESSION_KEY);
      expect(restoredState?.missionId).toBe(missionId);
      expect(
        restoredState?.products.map((record: { objectID: string }) => record.objectID),
      ).toEqual(records.map((record) => record.objectID));
      expect(restoredState?.compareIds).toEqual(['SAVED-1']);
      expect(restoredState?.activeView).toBe('compare');
    } finally {
      await context.close();
    }
  }
});
