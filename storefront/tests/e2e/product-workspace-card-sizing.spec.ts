import { expect, test, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const bravePath = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const baseUrl = process.env.JTV_CARD_SIZE_BASE_URL ?? 'http://localhost:5173';
const runDir = path.resolve(
  process.cwd(),
  '..',
  '.checkpoint',
  'runs',
  `stage5-product-card-sizing-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

test('single discovery card stays compact and multi-card shelves remain balanced', async () => {
  await fs.mkdir(runDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: bravePath, headless: true });
  const results: Record<string, unknown>[] = [];
  try {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const apiCalls: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url());
      });
      await page.route('**/product-images/*.svg', async (route) => {
        const name = new URL(route.request().url()).pathname.split('/').at(-1);
        const asset =
          name === 'portrait.svg'
            ? { width: 90, height: 150, color: '#d9e8ef' }
            : { width: 180, height: 100, color: '#e9ded2' };
        await route.fulfill({
          contentType: 'image/svg+xml',
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}" viewBox="0 0 ${asset.width} ${asset.height}"><rect width="100%" height="100%" fill="${asset.color}"/></svg>`,
        });
      });
      await page.route('**/__product-workspace-sizing-fixture', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><html><head></head><body>
            <script type="module">
              import RefreshRuntime from '/@react-refresh';
              RefreshRuntime.injectIntoGlobalHook(window);
              window.$RefreshReg$ = () => {};
              window.$RefreshSig$ = () => (type) => type;
              window.__vite_plugin_react_preamble_installed__ = true;
            </script>
          </body></html>`,
        }),
      );
      await page.goto(`${baseUrl}/__product-workspace-sizing-fixture`);
      await page.evaluate(async () => {
        const reactModule = '/node_modules/.vite/deps/react.js';
        const reactDomModule = '/node_modules/.vite/deps/react-dom_client.js';
        const productWorkspaceModule = '/src/ProductWorkspace.tsx';
        const catalogModule = '/src/catalog/index.ts';
        await import('/src/styles.css');
        await import('/src/integration.css');
        const ReactModule = await import(reactModule);
        const React = ReactModule.default;
        const ReactDomModule = await import(reactDomModule);
        const { createRoot } = ReactDomModule.default;
        const [{ ProductWorkspace }, { normalizeProduct }] = await Promise.all([
          import(productWorkspaceModule),
          import(catalogModule),
        ]);
        const container = document.createElement('main');
        container.id = 'sizing-fixture';
        container.style.cssText =
          'width:min(100%, 890px); margin-left:max(0px, calc(100% - 915px));';
        document.body.append(container);
        const root = createRoot(container);
        const source = {
          objectID: 'VG320P',
          Catalog_TitleDescription:
            '14k White Gold Diamond Cut 0.65mm Wheat Pendant Chain 22 Inches',
          Catalog_LongDescription:
            'Exact catalogue item VG320P, SKU VG320P-22: 22-inch chain, in stock, first quality, and listed at $461.69, within your $500 budget.',
          Catalog_ProductType: 'Necklace',
          Catalog_Condition: 'First Quality',
          Catalog_JewelryMaterialNavigationName: ['Gold'],
          Catalog_JewelryMaterialNavigationPurity: ['14K'],
          Catalog_JewelryMaterialNavigationColor: ['White'],
          Inventory_InStock: true,
          Pricing_ActivePrice: 461.69,
          Media_Images: ['https://images.jtv.com/jewelry/gold/JTV-VG320P-1.jpg'],
        };
        const products = [
          normalizeProduct(source),
          normalizeProduct({
            ...source,
            objectID: 'VG320P-B',
            Catalog_TitleDescription:
              'A notably long 14k white-gold diamond-cut cable chain necklace with a lobster clasp',
            Media_Images: ['https://fixture.test/product-images/portrait.svg'],
          }),
          normalizeProduct({
            ...source,
            objectID: 'VG320P-C',
            Catalog_TitleDescription:
              '14k white-gold wheat chain with a long descriptive product title that needs wrapping',
            Media_Images: ['https://fixture.test/product-images/landscape.svg'],
          }),
          ...Array.from({ length: 6 }, (_, index) =>
            normalizeProduct({
              ...source,
              objectID: `VG320P-${index + 4}`,
              Catalog_TitleDescription: `Catalogue-backed variation ${index + 4} with a distinct chain finish and length`,
              Media_Images: ['https://fixture.test/product-images/landscape.svg'],
            }),
          ),
        ];
        const noop = () => undefined;
        const model = (
          count: number,
          groupCount: number,
          activeView: 'discover' | 'saved' | 'compare' | 'combination' = 'discover',
        ) => {
          const items = products.slice(0, count).map((product, index) => ({
            product,
            why:
              count === 3
                ? [
                    'A close variation with a longer explanation that wraps across several lines and makes the first card taller.',
                    'A shorter explanation.',
                    'Another variation with a medium-length explanation for the third card.',
                  ][index]
                : undefined,
          }));
          const discoveries =
            groupCount === 1
              ? [{ title: 'Exact catalogue choice', items }]
              : groupCount === 2
                ? [
                    { title: 'Bracelet style: Strand', items: items.slice(0, 2) },
                    { title: 'Bracelet style: Link', items: items.slice(2) },
                  ]
                : count === 9
                  ? Array.from({ length: 3 }, (_, index) => ({
                      title: `Necklace style: Direction ${index + 1}`,
                      items: items.slice(index * 3, index * 3 + 3),
                    }))
                  : items.map((item, index) => ({ title: `Choice ${index + 1}`, items: [item] }));
          return {
            products:
              count === 3
                ? products.slice(0, 3).map((product) => ({
                    product,
                    quantity: 1,
                    observedAt: 'fixture',
                  }))
                : [],
            selectionRecords: products.slice(0, count),
            discoveries,
            activeView,
            setView: noop,
            compareIds: count === 3 ? [products[0].id, products[1].id] : [],
            combinationIds: count === 3 ? [products[0].id, products[1].id] : [],
            combinationQuantities: {},
            toggleCompare: noop,
            toggleCombination: noop,
            pin: noop,
            remove: noop,
            setQuantity: noop,
            refreshProducts: async () => undefined,
            refreshing: false,
            refreshError: '',
            budgetCents: 50000,
            budgetScope: 'total' as const,
          };
        };
        Object.assign(window, {
          renderProductFixture(
            count: number,
            groupCount: number,
            view: 'discover' | 'saved' | 'compare' | 'combination' = 'discover',
          ) {
            root.render(
              React.createElement(ProductWorkspace, { model: model(count, groupCount, view) }),
            );
          },
        });
      });

      for (const scenario of [
        { key: 'single', count: 1, groups: 1 },
        { key: 'three-card-gallery', count: 3, groups: 1 },
        { key: 'three-direction-shelves', count: 3, groups: 3 },
        { key: 'two-actual-styles', count: 3, groups: 2 },
        { key: 'three-style-families', count: 9, groups: 3 },
      ]) {
        await page.evaluate(
          ({ count, groups }) => {
            (
              window as unknown as { renderProductFixture: (n: number, g: number) => void }
            ).renderProductFixture(count, groups);
          },
          { count: scenario.count, groups: scenario.groups },
        );
        const cards = page.locator('.pw-discover .pw-product:visible');
        await expect(cards).toHaveCount(
          scenario.count === 9 ? 3 : scenario.groups === 2 ? 2 : scenario.count,
        );
        if (scenario.groups === 2) {
          const more = page.getByRole('button', { name: 'See 1 more in this style' });
          await expect(more).toHaveCount(1);
          await expect(page.locator('.pw-discovery-group')).toHaveCount(2);
          await more.click();
          await expect(cards).toHaveCount(3);
        }
        if (scenario.count === 9) {
          const more = page.getByRole('button', { name: /See 2 more in this style/ });
          await expect(more).toHaveCount(3);
          await page.screenshot({
            path: path.join(runDir, `${viewport.width}-three-style-families-collapsed.png`),
            fullPage: true,
          });
          for (const visibleCount of [5, 7, 9]) {
            await more.first().click();
            await expect(cards).toHaveCount(visibleCount);
          }
          await expect(page.locator('.pw-discovery-groups .pw-product')).toHaveCount(9);
          expect(
            await cards.evaluateAll(
              (nodes) => new Set(nodes.map((node) => node.getAttribute('data-product-id'))).size,
            ),
          ).toBe(9);
        }
        await expect
          .poll(() =>
            page
              .locator('.pw-image img')
              .evaluateAll((images) =>
                images.every(
                  (image) =>
                    (image as HTMLImageElement).complete &&
                    (image as HTMLImageElement).naturalWidth > 0,
                ),
              ),
          )
          .toBe(true);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );

        const metrics = await page.evaluate(() => {
          const rect = (element: Element | null) => {
            if (!element) return null;
            const { x, y, width, height, bottom, right } = element.getBoundingClientRect();
            return { x, y, width, height, bottom, right };
          };
          const cardNodes = [...document.querySelectorAll('.pw-discover .pw-product')];
          const images = [...document.querySelectorAll('.pw-discover .pw-image')];
          const image = images[0];
          const title = document.querySelector('.pw-discover .pw-product h3');
          const price = document.querySelector('.pw-discover .pw-price');
          const groupImages = [
            ...document.querySelectorAll(
              '.pw-discovery-groups:not([data-group-count="1"]) .pw-image',
            ),
          ];
          return {
            viewport: { width: innerWidth, height: innerHeight },
            documentWidth: document.documentElement.scrollWidth,
            apiCalls: [],
            cards: cardNodes.map(rect),
            actions: cardNodes.map((card) => {
              const row = card.querySelector('.pw-actions');
              return {
                row: rect(row),
                buttons: [...(row?.querySelectorAll('button') ?? [])].map((button) => ({
                  text: button.textContent?.trim(),
                  bounds: rect(button),
                })),
              };
            }),
            image: rect(image),
            imageNaturalWidth: (image?.querySelector('img') as HTMLImageElement | null)
              ?.naturalWidth,
            imageObjectFit: image ? getComputedStyle(image.querySelector('img')!).objectFit : null,
            productImages: images.map((node) => {
              const image = node.querySelector('img') as HTMLImageElement | null;
              return {
                ...rect(node),
                naturalWidth: image?.naturalWidth,
                naturalHeight: image?.naturalHeight,
                objectFit: image ? getComputedStyle(image).objectFit : null,
                source: image?.currentSrc,
              };
            }),
            title: rect(title),
            price: rect(price),
            directionImageWidths: groupImages.map((node) => rect(node)?.width),
            titleText: title?.textContent,
            priceText: price?.textContent,
          };
        });
        const measured = { ...metrics, apiCalls, scenario: scenario.key };
        results.push(measured);
        await page.screenshot({
          path: path.join(runDir, `${viewport.width}-${scenario.key}.png`),
          fullPage: true,
        });

        expect(
          metrics.documentWidth,
          `${scenario.key} should not overflow at ${viewport.width}px`,
        ).toBeLessThanOrEqual(viewport.width);
        expect(apiCalls, 'fixture replay must not make chat or product API calls').toEqual([]);
        for (const [index, action] of metrics.actions.entries()) {
          const card = metrics.cards[index];
          for (const button of action.buttons) {
            expect(
              button.bounds?.x,
              `${scenario.key}: ${button.text} stays inside its card`,
            ).toBeGreaterThanOrEqual((card?.x ?? 0) - 1);
            expect(
              button.bounds?.right,
              `${scenario.key}: ${button.text} stays inside its card`,
            ).toBeLessThanOrEqual((card?.right ?? 0) + 1);
          }
        }
        if (scenario.key === 'single') {
          expect(metrics.image?.height).toBeLessThanOrEqual(360);
          expect(metrics.cards[0]?.height).toBeLessThanOrEqual(700);
          expect(metrics.cards[0]).toBeTruthy();
          expect(metrics.imageNaturalWidth).toBeGreaterThan(0);
          expect(metrics.imageObjectFit).toBe('contain');
          expect(metrics.priceText).toBe('$461.69');
          const visiblePaneBottom =
            viewport.width === 1440
              ? 847
              : viewport.width === 375
                ? viewport.height - 72
                : viewport.height;
          expect(metrics.title?.bottom).toBeLessThanOrEqual(visiblePaneBottom);
          expect(metrics.price?.bottom).toBeLessThanOrEqual(visiblePaneBottom);
          if (viewport.width === 768) expect(metrics.image?.height).toBeLessThanOrEqual(300);
          if (viewport.width === 375) expect(metrics.image?.height).toBeLessThanOrEqual(260);
        }
        if (scenario.key === 'three-card-gallery' && viewport.width >= 768) {
          const actionBottoms = metrics.actions.map((action) => action.row?.bottom ?? 0);
          expect(Math.max(...actionBottoms) - Math.min(...actionBottoms)).toBeLessThanOrEqual(2);
          const cardWidths = metrics.cards.map((card) => card?.width ?? 0);
          expect(Math.max(...cardWidths) - Math.min(...cardWidths)).toBeLessThanOrEqual(2);
          expect(new Set(metrics.cards.map((card) => Math.round(card?.x ?? 0))).size).toBe(3);
          expect(metrics.productImages.every((image) => (image?.height ?? Infinity) <= 300)).toBe(
            true,
          );
          expect(new Set(metrics.productImages.map((image) => image?.height)).size).toBe(1);
          expect(metrics.productImages.every((image) => (image?.naturalWidth ?? 0) > 0)).toBe(true);
          expect(metrics.productImages.every((image) => image?.objectFit === 'contain')).toBe(true);
        }
        if (scenario.key === 'three-direction-shelves') {
          expect(metrics.directionImageWidths).toHaveLength(3);
          expect(
            metrics.directionImageWidths.every(
              (width, index) => (width ?? Infinity) <= (metrics.cards[index]?.width ?? 0),
            ),
          ).toBe(true);
          expect(metrics.productImages.every((image) => (image?.height ?? Infinity) <= 185)).toBe(
            true,
          );
        }
      }

      for (const view of ['saved', 'compare', 'combination'] as const) {
        await page.evaluate((nextView) => {
          (
            window as unknown as {
              renderProductFixture: (count: number, groups: number, view: string) => void;
            }
          ).renderProductFixture(3, 1, nextView);
        }, view);
        const rows = page.locator(
          view === 'saved' ? '.pw-saved .pw-actions' : '.pw-selection .pw-compare-actions',
        );
        await expect(rows).toHaveCount(view === 'saved' ? 3 : 2);
        const imageHeights = await page
          .locator(
            view === 'saved' ? '.pw-saved .pw-image' : '.pw-selection .pw-compare-image .pw-image',
          )
          .evaluateAll((images) => images.map((image) => image.getBoundingClientRect().height));
        const maxImageHeight = view === 'saved' ? (viewport.width <= 480 ? 240 : 360) : 200;
        expect(
          imageHeights.every((height) => height <= maxImageHeight),
          `${view} images stay bounded at ${viewport.width}px`,
        ).toBe(true);
        if (view === 'combination' && viewport.width <= 480) {
          const columns = await page
            .locator('.pw-comparison')
            .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
          expect(columns).toBe(1);
        }
        const geometry = await rows.evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect();
            const buttons = [...node.children].filter((child) => child.tagName === 'BUTTON');
            return {
              display: getComputedStyle(node).display,
              columns: getComputedStyle(node).gridTemplateColumns.split(' ').length,
              top: box.top,
              x: box.x,
              right: box.right,
              buttons: buttons.map((button) => {
                const rect = button.getBoundingClientRect();
                const style = getComputedStyle(button);
                return {
                  x: rect.x,
                  right: rect.right,
                  top: rect.top,
                  bottom: rect.bottom,
                  height: rect.height,
                  borderWidth: style.borderTopWidth,
                  radius: style.borderTopLeftRadius,
                };
              }),
            };
          }),
        );
        for (const row of geometry) {
          expect(row.display, `${view} action layout`).toBe('grid');
          expect(row.columns, `${view} action columns`).toBe(2);
          expect(row.buttons, `${view} action count`).toHaveLength(3);
          expect(row.x, `${view} action left edge`).toBeGreaterThanOrEqual(-1);
          expect(row.right, `${view} action right edge`).toBeLessThanOrEqual(viewport.width + 1);
          expect(row.buttons[0].top).toBe(row.buttons[1].top);
          expect(row.buttons[2].top).toBeGreaterThanOrEqual(row.buttons[0].bottom);
          expect(row.buttons[2].x).toBeGreaterThanOrEqual(row.x - 1);
          expect(row.buttons[2].right).toBeLessThanOrEqual(row.right + 1);
          expect(row.buttons.every((button) => button.height >= 44)).toBe(true);
          expect(row.buttons.every((button) => button.borderWidth === '1px')).toBe(true);
          expect(row.buttons.every((button) => button.radius === '4px')).toBe(true);
        }
        const alignedRows =
          view === 'saved'
            ? viewport.width >= 900
              ? geometry
              : viewport.width >= 480
                ? geometry.slice(0, 2)
                : []
            : viewport.width >= 768
              ? geometry
              : [];
        if (alignedRows.length > 1) {
          const tops = alignedRows.map((row) => row.top);
          expect(
            Math.max(...tops) - Math.min(...tops),
            `${view} action row alignment`,
          ).toBeLessThanOrEqual(2);
        }
        await page.screenshot({
          path: path.join(runDir, `${viewport.width}-${view}-actions.png`),
          fullPage: true,
        });
      }
      await context.close();
    }
    await fs.writeFile(path.join(runDir, 'measurements.json'), JSON.stringify(results, null, 2));
  } finally {
    await fs.writeFile(path.join(runDir, 'measurements.json'), JSON.stringify(results, null, 2));
    await browser.close();
  }
});
