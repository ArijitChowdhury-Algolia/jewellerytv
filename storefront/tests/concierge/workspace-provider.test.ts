import { describe, expect, it } from 'vitest';
import { createBriefStateV3 } from '../../shared/briefState';
import { createConciergeWorkspaceSession } from '../../src/concierge/ConciergeWorkspaceProvider';
import { V3_SESSION_KEY, type StorageLike } from '../../src/concierge/sessionPersistence';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function session(binding: 'evidence_bound' | 'legacy_unbound' = 'evidence_bound') {
  const raw = {
    objectID: 'saved-1',
    Catalog_TitleDescription: 'Saved necklace',
    Pricing_ActivePrice: 125,
    Media_Images: [],
  };
  return {
    version: 3,
    missionId: 'mission-provider',
    brief: createBriefStateV3('mission-provider'),
    products: [
      {
        sourceIndex: 'prod_catalog',
        objectID: 'saved-1',
        raw,
        quantity: 1,
        observedAt: null,
        binding,
        contentHash: binding === 'evidence_bound' ? 'hash-1' : null,
        evidenceRef: binding === 'evidence_bound' ? 'ref-1' : null,
      },
    ],
    selectionRecords: [
      {
        sourceIndex: 'prod_catalog',
        objectID: 'saved-1',
        raw,
        quantity: 1,
        observedAt: null,
        binding,
        contentHash: binding === 'evidence_bound' ? 'hash-1' : null,
        evidenceRef: binding === 'evidence_bound' ? 'ref-1' : null,
      },
    ],
    compareIds: ['saved-1'],
    combinationIds: [],
    combinationQuantities: {},
    activeView: 'compare',
    receipts: [],
    evidence:
      binding === 'evidence_bound'
        ? [
            {
              evidenceRef: 'ref-1',
              sourceIndex: 'prod_catalog',
              objectID: 'saved-1',
              contentHash: 'hash-1',
            },
          ]
        : [],
  };
}

describe('v3 workspace session adapter', () => {
  it('rehydrates Saved-only Compare from the canonical store', () => {
    const storage = new MemoryStorage();
    storage.setItem(V3_SESSION_KEY, JSON.stringify(session()));
    const adapter = createConciergeWorkspaceSession({
      storage,
      initialMissionId: 'unused',
      getCurrentShopperMessage: () => null,
      fetchEvidence: async () => {
        throw new Error('unused');
      },
    });
    const model = adapter.getModel();
    expect(model.activeView).toBe('compare');
    expect(model.compareIds).toEqual(['saved-1']);
    expect(model.products[0].product.id).toBe('saved-1');
  });
  it('marks legacy unbound Saved records as needing verification', () => {
    const storage = new MemoryStorage();
    storage.setItem(V3_SESSION_KEY, JSON.stringify(session('legacy_unbound')));
    const adapter = createConciergeWorkspaceSession({
      storage,
      initialMissionId: 'unused',
      getCurrentShopperMessage: () => null,
      fetchEvidence: async () => {
        throw new Error('unused');
      },
    });
    const model = adapter.getModel();
    expect(model.assessment?.(model.products[0].product)).toBe('Needs verification');
  });
});
