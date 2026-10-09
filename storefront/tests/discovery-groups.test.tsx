import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeProduct } from '../src/catalog';
import { ProductWorkspace, type WorkspaceViewModel } from '../src/ProductWorkspace';

const product = (id: string) =>
  normalizeProduct({
    objectID: id,
    Catalog_TitleDescription: `Piece ${id}`,
    Pricing_ActivePrice: 99,
    Media_Images: [],
  });
function model(): WorkspaceViewModel {
  const a = product('a'),
    b = product('b'),
    c = product('c'),
    d = product('d');
  return {
    products: [],
    selectionRecords: [a, b, c, d],
    discoveries: [
      {
        title: 'Everyday',
        items: [
          { product: a, why: 'One' },
          { product: b, why: 'Two' },
          { product: a, why: 'Duplicate' },
        ],
      },
      { title: 'Statement', items: [{ product: c, why: 'Three' }] },
      { title: 'Gift', items: [{ product: d, why: 'Four' }] },
    ],
    activeView: 'discover',
    setView: vi.fn(),
    compareIds: [],
    toggleCompare: vi.fn(),
    pin: vi.fn(),
    remove: vi.fn(),
    refreshProducts: vi.fn(async () => undefined),
    refreshing: false,
    refreshError: '',
  };
}
describe('grouped discovery workspace', () => {
  it('renders up to three validated direction columns and deduplicates within a group', () => {
    const html = renderToStaticMarkup(<ProductWorkspace model={model()} />);
    expect(html).toContain('class="pw-discovery-groups"');
    expect(html).toContain('data-group-count="3"');
    expect(html).toContain('aria-labelledby="pw-group-0"');
    expect(html.match(/data-product-id="a"/g)?.length).toBe(1);
    expect(html).toContain('Everyday');
    expect(html).toContain('Statement');
    expect(html).toContain('Gift');
  });

  it('renders proposed looks in Saved with saved pieces marked', () => {
    const workspace = model();
    workspace.activeView = 'saved';
    workspace.products = [{ product: product('a'), quantity: 1, observedAt: '' }];
    workspace.proposedLooks = [
      {
        title: 'Everyday Gold Trio',
        lines: [
          { product: product('a'), why: 'Anchor', quantity: 1 },
          { product: product('c'), why: 'Companion', quantity: 1 },
        ],
        itemSubtotalCents: 19800,
      },
    ];
    const html = renderToStaticMarkup(<ProductWorkspace model={workspace} />);
    expect(html).toContain('Everyday Gold Trio');
    expect(html).toContain('Selected ✓');
    expect(html).toContain('$198.00');
    expect(html).not.toContain('Add to combination');
    expect(html).not.toContain('Quantity');
  });
});
