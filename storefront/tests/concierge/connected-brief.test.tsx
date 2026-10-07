import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BriefStateV3 } from '../../shared/briefSchema';
import { ConnectedShoppingBrief } from '../../src/concierge/ConnectedShoppingBrief';

const brief: BriefStateV3 = {
  version: 3,
  missionId: 'mission-1',
  revision: 3,
  processedTurns: [],
  tombstones: [],
  events: [],
  facts: [
    {
      id: 'budget',
      field: 'budget',
      value: { kind: 'money', cents: 50000, currency: 'USD', operator: 'lte', basis: 'total' },
      scope: { kind: 'mission', key: null },
      strength: 'requirement',
      certainty: 'explicit',
      origin: 'spoken',
      evidence: { messageId: 'm1', quote: '$500 combined', explicit: true, verified: true },
      status: 'active',
      revision: 1,
      createdAt: '2026-10-06T00:00:00Z',
    },
    {
      id: 'materials',
      field: 'material',
      value: {
        kind: 'material_alternatives',
        alternatives: [
          { type: 'Silver', color: null, purity: 'Sterling', plating: null },
          { type: 'Gold', color: 'White', purity: '14K', plating: null },
        ],
      },
      scope: { kind: 'item', key: 'necklace' },
      strength: 'preference',
      certainty: 'explicit',
      origin: 'spoken',
      evidence: { messageId: 'm1', quote: 'silver or white gold', explicit: true, verified: true },
      status: 'active',
      revision: 2,
      createdAt: '2026-10-06T00:00:00Z',
    },
    {
      id: 'exclusions',
      field: 'exclusion',
      value: {
        kind: 'facet',
        attribute: 'Catalog_StyleOptionTag',
        values: ['Hearts', 'Stars'],
        operator: 'none',
      },
      scope: { kind: 'mission', key: null },
      strength: 'requirement',
      certainty: 'explicit',
      origin: 'ui',
      evidence: { messageId: 'm2', quote: 'no hearts or stars', explicit: true, verified: true },
      status: 'active',
      revision: 3,
      createdAt: '2026-10-06T00:00:00Z',
    },
  ],
};

describe('v3 Connected Preferences', () => {
  it('renders compact chips while preserving money basis, structured materials, and multiple exclusions', () => {
    const html = renderToStaticMarkup(
      <ConnectedShoppingBrief
        brief={brief}
        onAdd={vi.fn()}
        onReplace={vi.fn()}
        onRetract={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    expect(html).toContain('Preferences (3)');
    expect(html).toContain('$500.00 total');
    expect(html).toContain('Silver Sterling or Gold White 14K');
    expect(html).toContain('No Hearts or Stars');
    expect(html).toContain('necklace');
    expect(html).not.toContain('ShoppingProvider');
  });

  it('keeps the compact editor folded by default and exposes an accessible toggle', () => {
    const html = renderToStaticMarkup(
      <ConnectedShoppingBrief
        brief={{ ...brief, facts: [] }}
        onAdd={vi.fn()}
        onReplace={vi.fn()}
        onRetract={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Preferences (0)');
    expect(html).toContain('Add preference');
    expect(html).toContain('hidden=""');
  });
});
