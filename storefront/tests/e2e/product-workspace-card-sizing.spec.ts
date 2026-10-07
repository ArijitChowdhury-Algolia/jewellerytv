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
        ];
        const noop = () => undefined;
        const model = (count: number, groupCount: number) => {
          const items = products.slice(0, count).map((product) => ({ product }));
          const discoveries =
            groupCount === 1
              ? [{ title: 'Exact catalogue choice', items }]
              : items.map((item, index) => ({ title: `Choice ${index + 1}`, items: [item] }));
          return {
            products: [],
            selectionRecords: products.slice(0, count),
            discoveries,
            activeView: 'discover' as const,
            setView: noop,
            compareIds: [],
            combinationIds: [],
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
          renderProductFixture(count: number, groupCount: number) {
            root.render(React.createElement(ProductWorkspace, { model: model(count, groupCount) }));
          },
        });
      });

      for (const scenario of [
        { key: 'single', count: 1, groups: 1 },
        { key: 'three-card-gallery', count: 3, groups: 1 },
        { key: 'three-direction-shelves', count: 3, groups: 3 },
      ]) {
        await page.evaluate(
          ({ count, groups }) => {
            (
              window as unknown as { renderProductFixture: (n: number, g: number) => void }
            ).renderProductFixture(count, groups);
          },
          { count: scenario.count, groups: scenario.groups },
        );
        const cards = page.locator('.pw-discover .pw-product');
        await expect(cards).toHaveCount(scenario.count);
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
          expect(metrics.directionImageWidths).toEqual([96, 96, 96]);
        }
      }
      await context.close();
    }
    await fs.writeFile(path.join(runDir, 'measurements.json'), JSON.stringify(results, null, 2));
  } finally {
    await fs.writeFile(path.join(runDir, 'measurements.json'), JSON.stringify(results, null, 2));
    await browser.close();
  }
});
