import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BriefStateV3 } from '../../shared/briefSchema';
import { ConnectedShoppingBrief } from '../../src/concierge/ConnectedShoppingBrief';
import { ConciergeWorkspaceLayout } from '../../src/concierge/ConciergeWorkspaceLayout';
import { ShoppingWorkspace } from '../../src/ShoppingWorkspace';
import { normalizeProduct } from '../../src/catalog';
import type { WorkspaceViewModel } from '../../src/ProductWorkspace';

const piece = normalizeProduct({
  objectID: 'piece-1',
  Catalog_TitleDescription: 'Sterling silver necklace',
  Pricing_ActivePrice: 125,
  Media_Images: [],
});
const blankBrief: BriefStateV3 = {
  version: 3,
  missionId: 'mission-restored',
  revision: 0,
  facts: [],
  processedTurns: [],
  tombstones: [],
  events: [],
};

function workspace(view: WorkspaceViewModel['activeView'] = 'discover'): WorkspaceViewModel {
  return {
    products: view === 'saved' ? [{ product: piece, quantity: 1, observedAt: 'now' }] : [],
    selectionRecords: [piece],
    discoveries: [{ title: 'A direction', items: [{ product: piece, why: 'A grounded choice' }] }],
    activeView: view,
    setView: vi.fn(),
    compareIds: view === 'compare' ? ['piece-1'] : [],
    toggleCompare: vi.fn(),
    pin: vi.fn(),
    remove: vi.fn(),
    refreshProducts: vi.fn(async () => undefined),
    refreshing: false,
    refreshError: '',
  };
}

function modal(view: WorkspaceViewModel['activeView'] = 'discover') {
  return (
    <ConciergeWorkspaceLayout
      headerActions={
        <>
          <button type="button">New conversation</button>
          <button type="button">Close</button>
        </>
      }
      preferenceControls={
        <ConnectedShoppingBrief
          brief={blankBrief}
          onAdd={vi.fn()}
          onReplace={vi.fn()}
          onRetract={vi.fn()}
          onUndo={vi.fn()}
        />
      }
      messages={<p>Conversation answer</p>}
      status={<p role="status">Concierge is considering your request.</p>}
      composer={
        <label>
          Ask the Concierge
          <input aria-label="Ask the Concierge" />
        </label>
      }
      productWorkspace={<ShoppingWorkspace model={workspace(view)} />}
      sectionSwitch={
        <>
          <button aria-pressed={view === 'discover'}>Conversation</button>
          <button aria-pressed={view === 'saved'}>Products</button>
        </>
      }
      section={view === 'saved' ? 'shopping' : 'conversation'}
    />
  );
}

describe('restored approved workspace composition', () => {
  it('renders the two columns, compact Preferences count, tabs, and populated product actions', () => {
    const html = renderToStaticMarkup(modal());
    expect(html).toContain('class="conversation-column"');
    expect(html).toContain('class="shopping-column"');
    expect(html).toContain('Preferences (0)');
    expect(html).toContain('Discover');
    expect(html).toContain('Selected');
    expect(html).toContain('Compare');
    expect(html).toContain('Save');
    expect(html).not.toContain('Add to combination');
  });

  it('keeps saved and compare labels available for populated views', () => {
    for (const view of ['saved', 'compare'] as const) {
      const html = renderToStaticMarkup(modal(view));
      expect(html).toContain(view === 'saved' ? 'Remove from Selected' : 'Remove from comparison');
    }
  });

  it('shows honest empty states and a mobile Products section marker', () => {
    const emptyModel = {
      ...workspace('saved'),
      products: [],
      discoveries: [],
      selectionRecords: [],
    };
    const html = renderToStaticMarkup(
      <ConciergeWorkspaceLayout
        headerActions={<button type="button">Close</button>}
        preferenceControls={
          <button type="button" aria-expanded="false">
            Preferences (0)
          </button>
        }
        messages={<p>Conversation</p>}
        composer={<button type="button">Send</button>}
        productWorkspace={<ShoppingWorkspace model={emptyModel} />}
        sectionSwitch={<button aria-pressed="true">Products</button>}
        section="shopping"
      />,
    );
    expect(html).toContain('data-section="shopping"');
    expect(html).toContain('Save a piece you like, and keep it here.');
    expect(html).toContain('aria-expanded="false"');
  });
});
