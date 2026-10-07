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
    combinationIds: [],
    combinationQuantities: {},
    toggleCompare: vi.fn(),
    toggleCombination: vi.fn(),
    pin: vi.fn(),
    remove: vi.fn(),
    setQuantity: vi.fn(),
    refreshProducts: vi.fn(async () => undefined),
    refreshing: false,
    refreshError: '',
    budgetCents: null,
    budgetScope: 'total',
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

  it('keeps the add-to-combination action visible and marks selected pieces', () => {
    const workspace = model();
    workspace.combinationIds = ['a'];
    const html = renderToStaticMarkup(<ProductWorkspace model={workspace} />);
    expect(html).toContain('In combination ✓');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Add to combination');
    expect(html).not.toContain('<summary>More</summary>');
  });

  it('explains the three-piece limit and disables only new additions when full', () => {
    const workspace = model();
    workspace.combinationIds = ['a', 'b', 'c'];
    const html = renderToStaticMarkup(<ProductWorkspace model={workspace} />);
    expect(html).toContain('Combination limit reached. Remove one piece before adding another.');
    expect(html).toContain('id="pw-combination-limit"');
    expect(html).toContain('aria-describedby="pw-combination-limit"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add to combination<\/button>/);
  });
});
