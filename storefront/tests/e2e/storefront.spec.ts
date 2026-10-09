import { test, expect, type Page } from '@playwright/test';
import fixtures from '../../src/catalog/fixtures.json' with { type: 'json' };

const record = fixtures.records.find((item) => item.objectID === 'MFP256C')!;
const size = record.Inventory_AvailableSkuSizes![0];
const sizes = record.Inventory_AvailableSkuSizes!;
const noResults = 'zzzz-no-jewelry-fixture-49381';
async function fixtureApi(page: Page) {
  await page.route('**/api/search', async (route) => {
    const body = route.request().postDataJSON();
    const results = body.requests.map((request: { params?: Record<string, unknown> }) => {
      const params = request.params || {};
      const empty = String(params.query || '').includes(noResults);
      return {
        hits: empty ? [] : [record],
        nbHits: empty ? 0 : 1,
        page: 0,
        nbPages: empty ? 0 : 1,
        hitsPerPage: 24,
        processingTimeMS: 1,
        query: String(params.query || ''),
        exhaustiveNbHits: true,
        facets: {
          Pricing_PriceRange: { '$50 - $100': 1 },
          Inventory_AvailableSkuSizes: Object.fromEntries(sizes.map((s) => [s, 1])),
          Catalog_BrandNavigationName: { 'Moissanite Fire': 1 },
        },
        facets_stats: { Pricing_ActivePrice: { min: 94.99, max: 94.99, avg: 94.99, sum: 94.99 } },
        renderingContent: {},
      };
    });
    await route.fulfill({ json: { results } });
  });
  await page.route('**/api/products/*', (route) => route.fulfill({ json: record }));
  // Any accidental model submission fails visibly and never reaches the live service.
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 500,
      json: { error: 'Live model calls disabled in fixture browser tests' },
    }),
  );
}
async function openFacet(page: Page, name: string) {
  if (await page.getByRole('button', { name: 'Filter & Sort', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Filter & Sort', exact: true }).click();
  const facet = page
    .locator('details.facet')
    .filter({ has: page.locator('summary', { hasText: new RegExp(`^${name}$`) }) });
  if ((await facet.getAttribute('open')) === null) await facet.locator('summary').click();
  return facet;
}
async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

test.beforeEach(async ({ page }) => fixtureApi(page));

test('demo diagnostics stay hidden unless explicitly requested', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Demo diagnostics', { exact: true })).toHaveCount(0);
  await page.goto('/?debug=1');
  await expect(page.getByText('Demo diagnostics', { exact: true })).toBeVisible();
});

test('price and available size survive refresh and exact product return', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/search')) requests.push(request.postDataJSON());
  });
  await page.goto('/category/rings');
  await expect(page.locator('.results .product-card')).toHaveCount(1);
  const price = await openFacet(page, 'Price');
  await price.getByRole('checkbox', { name: /\$50 - \$100/ }).check();
  const ringSize = await openFacet(page, 'Ring Size');
  await ringSize
    .locator('label')
    .filter({ has: page.locator('span', { hasText: new RegExp(`^${size}$`) }) })
    .getByRole('checkbox')
    .check();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('f'))
    .toContain('Inventory_AvailableSkuSizes');
  const listingUrl = page.url();
  const refinements = JSON.parse(new URL(listingUrl).searchParams.get('f')!);
  expect(refinements.Pricing_PriceRange).toEqual(['$50 - $100']);
  expect(refinements.Inventory_AvailableSkuSizes).toEqual([size]);
  await page.reload();
  await expect(page.locator('.results .product-card')).toHaveCount(1);
  const priceAfter = await openFacet(page, 'Price');
  await expect(priceAfter.getByRole('checkbox', { name: /\$50 - \$100/ })).toBeChecked();
  const sizeAfter = await openFacet(page, 'Ring Size');
  await expect(
    sizeAfter
      .locator('label')
      .filter({ has: page.locator('span', { hasText: new RegExp(`^${size}$`) }) })
      .getByRole('checkbox'),
  ).toBeChecked();
  await page.locator('.results .product-link').first().click();
  await expect(page).toHaveURL(/\/product\/MFP256C/);
  await expect(page.locator('.product-info h1')).toContainText('DEW');
  const productUrl = page.url();
  await page.goto(productUrl); // Direct load has no router return state.
  await page.getByRole('link', { name: 'Back to results', exact: true }).click();
  await expect(page).toHaveURL(listingUrl);
  await page.locator('.results .product-link').first().click();
  await page.goBack();
  await expect(page).toHaveURL(listingUrl);
  expect(JSON.stringify(requests)).toContain('Pricing_PriceRange');
  expect(JSON.stringify(requests)).toContain('Inventory_AvailableSkuSizes');
  await assertNoOverflow(page);
});

test('exact style shows its family and only captured available sizes', async ({ page }) => {
  await page.goto('/product/MFP256C');
  await expect(page.getByText('Item MFP256C · Family MFP256', { exact: true })).toBeVisible();
  await expect(page.locator('.size-options button')).toHaveText(
    record.Inventory_AvailableSkuSizeNames!,
  );
  await page.locator('.size-options button').first().click();
  await expect(page.locator('.size-options button').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.product-facts').first()).toContainText(
    'Actual moissanite weight is 1.50ctw.',
  );
  await assertNoOverflow(page);
});

test('no results is explicit and search can recover', async ({ page }) => {
  await page.goto(`/search?q=${noResults}`);
  await expect(page.getByRole('heading', { name: 'No products found' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search jewelry' }).fill('moissanite');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.results .product-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'No products found' })).toHaveCount(0);
  await assertNoOverflow(page);
});

test('concierge opens and resets without making a live model call', async ({ page }) => {
  let calls = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/chat')) calls++;
  });
  await page.goto('/category/rings');
  await expect(page.locator('.results .product-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open jewelry concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying concierge' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Start a new conversation', exact: true }).click();
  await expect(
    panel.getByRole('img', { name: 'JTV — Jewelry Television' }),
  ).toBeVisible();
  expect(calls).toBe(0);
  await assertNoOverflow(page);
});

test('pending Concierge status animates inside the composer without a Stop control', async ({
  page,
}) => {
  await page.clock.install();
  let releaseRequest!: () => void;
  await page.route('**/api/chat', async (route) => {
    await new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await route.fulfill({ status: 500, json: { error: 'Fixture request completed' } });
  });
  await page.goto('/category/rings');
  await page.getByRole('button', { name: 'Open jewelry concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying concierge' });
  await panel
    .getByRole('textbox', { name: 'Message the Concierge' })
    .fill('Find a simple necklace');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.locator('.connected-progress-label')).toHaveText('Sending to Concierge');
  await expect(panel.locator('.connected-progress-dot')).toHaveCount(3);
  expect(
    await panel
      .locator('.connected-progress-dot')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('concierge-status-pulse');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await panel
      .locator('.connected-progress-dot')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toHaveAttribute(
    'placeholder',
    '',
  );
  await expect(panel.locator('.connected-status')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.clock.fastForward(11_000);
  await expect(panel.locator('.connected-progress-label')).toHaveText('Sending to Concierge');
  await expect(panel.locator('.connected-progress-time')).toHaveText('11s');
  await page.clock.fastForward(20_000);
  await expect(panel.locator('.connected-progress-label')).toHaveText('Sending to Concierge');
  await expect(panel.locator('.connected-progress-time')).toHaveText('31s');
  releaseRequest();
  await expect(panel.locator('.connected-progress')).toHaveCount(0);
  await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toBeEnabled();
  await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toHaveAttribute(
    'placeholder',
    'Shall we find something delighting?',
  );
});

test('Concierge progress follows streamed tool and reply events', async ({ page }) => {
  type ProgressWindow = Window & {
    emitProgress?: (event: unknown) => void;
    closeProgress?: () => void;
  };
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw, location.href).pathname !== '/api/chat') return originalFetch(input, init);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          (window as ProgressWindow).emitProgress = (event) =>
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          (window as ProgressWindow).closeProgress = () => controller.close();
        },
      });
      return Promise.resolve(
        new Response(stream, {
          headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
        }),
      );
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open jewelry concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying concierge' });
  await panel.getByRole('textbox', { name: 'Message the Concierge' }).fill('Find earrings');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await page.evaluate(() => {
    (window as ProgressWindow).emitProgress?.({ type: 'start', messageId: 'assistant-progress' });
  });
  await expect(panel.locator('.connected-progress-label')).toHaveText('Concierge is working');
  await page.evaluate(() => {
    (window as ProgressWindow).emitProgress?.({
      type: 'tool-input-start',
      toolName: 'update_shopping_state',
      toolCallId: 'call-progress',
    });
  });
  await expect(panel.locator('.connected-progress-label')).toHaveText('Updating preferences');
  await page.evaluate(() => {
    const emit = (window as ProgressWindow).emitProgress;
    emit?.({ type: 'text-start', id: 'text-progress' });
    emit?.({ type: 'text-delta', id: 'text-progress', delta: 'A useful thought.' });
  });
  await expect(panel.locator('.connected-progress-label')).toHaveText('Concierge is replying');
  await expect(panel.locator('.connected-status')).toHaveCount(0);
  await page.evaluate(() => (window as ProgressWindow).closeProgress?.());
});
