import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeProduct } from '../src/catalog';
import {
  ProductWorkspace,
  workspaceCompareAction,
  workspaceSaveAction,
  type WorkspaceViewModel,
} from '../src/ProductWorkspace';

const product = normalizeProduct({
  objectID: 'saved-1',
  Catalog_TitleDescription: 'Saved necklace',
  Pricing_ActivePrice: null,
  Media_Images: [],
});

function model(activeView: WorkspaceViewModel['activeView'] = 'discover'): WorkspaceViewModel {
  return {
    products: [{ product, quantity: 1, observedAt: '2026-10-06T00:00:00Z' }],
    selectionRecords: [product],
    discoveries: [
      {
        title: 'One choice',
        items: [{ product, why: 'A useful direction', assessment: 'unknown' }],
      },
    ],
    activeView,
    setView: vi.fn(),
    compareIds: ['saved-1', 'missing-1'],
    toggleCompare: vi.fn(),
    pin: vi.fn(),
    remove: vi.fn(),
    refreshProducts: vi.fn(async () => undefined),
    refreshing: false,
    refreshError: '',
    assessment: (_item, status) => (status === 'unknown' ? <p>Needs verification</p> : null),
  };
}

describe('v3-ready workspace view model', () => {
  it('renders three tabs and supplied action labels without a legacy provider', () => {
    const html = renderToStaticMarkup(<ProductWorkspace model={model()} />);
    expect(html).toContain('Discover');
    expect(html).toContain('Compare (2)');
    expect(html).toContain('Saved (1)');
    expect(html).not.toContain('Combination');
    expect(html).toContain('Save');
    expect(html).toContain('Compare');
    expect(html).toContain('Needs verification');
  });

  it('keeps unknown price and missing record honest in supplied compare view', () => {
    const html = renderToStaticMarkup(<ProductWorkspace model={model('compare')} />);
    expect(html).toContain('1 selected piece needs to be retrieved again');
  });

  it('shows a committed complete look and its verified subtotal without changing manual picks', () => {
    const supplied = model('saved');
    supplied.proposedLooks = [
      {
        title: 'Blue stone look',
        lines: [{ product, why: 'Chosen necklace', quantity: 1 }],
        itemSubtotalCents: 7999,
      },
    ];
    const html = renderToStaticMarkup(<ProductWorkspace model={supplied} />);
    expect(html).toContain('Blue stone look');
    expect(html).toContain('Saved necklace');
    expect(html).toContain('$79.99');
    expect(html).not.toContain('Add to combination');
  });

  it('routes Save and Compare through supplied deterministic actions', () => {
    const supplied = model();
    workspaceSaveAction(supplied, product);
    workspaceCompareAction(supplied, product);
    expect(supplied.remove).toHaveBeenCalledWith('saved-1');
    expect(supplied.toggleCompare).toHaveBeenCalledWith('saved-1');
  });
});
