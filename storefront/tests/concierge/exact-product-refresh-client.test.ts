import { describe, expect, it } from 'vitest';
import { createBriefStateV3 } from '../../shared/briefState.js';
import { createExactProductRefresh } from '../../src/concierge/exactProductRefresh.js';
import { createSessionStore } from '../../src/concierge/sessionStore.js';
import { V3_SESSION_KEY, type StorageLike } from '../../src/concierge/sessionPersistence.js';
import type { RetrieveEvidenceResult } from '../../shared/concierge/retrieval/types.js';

type Request = {
  missionId: string;
  expectedRevision: number;
  turnId: string;
  exactObjectIDs: string[];
};
class Storage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
function setup(id = 'saved:blue') {
  const storage = new Storage();
  const raw = {
    objectID: id,
    Catalog_TitleDescription: 'Original necklace',
    Pricing_ActivePrice: 125,
  };
  const saved = {
    sourceIndex: 'prod_catalog',
    objectID: id,
    raw,
    quantity: 1,
    observedAt: null,
    binding: 'evidence_bound',
    contentHash: 'original',
    evidenceRef: 'original-ref',
  };
  storage.setItem(
    V3_SESSION_KEY,
    JSON.stringify({
      version: 3,
      missionId: 'mission',
      brief: createBriefStateV3('mission'),
      products: [saved],
      selectionRecords: [saved],
      compareIds: [id],
      activeView: 'compare',
      receipts: [],
      evidence: [
        {
          sourceIndex: 'prod_catalog',
          objectID: id,
          contentHash: 'original',
          evidenceRef: 'original-ref',
        },
      ],
    }),
  );
  return createSessionStore(storage, 'unused');
}
function response(
  request: Request,
  contentHash: string,
  evidenceRef: string,
): RetrieveEvidenceResult {
  const objectID = request.exactObjectIDs[0];
  return {
    status: 'ok',
    source: 'prod_catalog',
    missionId: request.missionId,
    revision: request.expectedRevision,
    expectedRevision: request.expectedRevision,
    turnId: request.turnId,
    effectiveFilters: [],
    unresolved: [],
    records: [
      {
        source: 'prod_catalog',
        objectID,
        contentHash,
        evidenceRef,
        retrievedAt: '2026-10-06T23:00:00.000Z',
        record: {
          objectID,
          Catalog_TitleDescription: 'Updated necklace',
          Pricing_ActivePrice: 130,
        },
      },
    ],
  };
}

describe('exact product refresh client', () => {
  it('accepts a colon ID allowed by the shared exact-ID schema', async () => {
    const store = setup();
    const refresh = createExactProductRefresh(store, async (body) => {
      const request = body as Request;
      return response(request, 'new-hash', 'prod_catalog/saved%3Ablue/new-hash');
    });
    await refresh.refreshProducts(['saved:blue']);
    expect(store.getSnapshot()?.products[0].raw.Pricing_ActivePrice).toBe(130);
    expect(store.getSnapshot()?.compareIds).toEqual(['saved:blue']);
  });

  it('rejects a mismatched hash/ref receipt and keeps the prior item', async () => {
    const store = setup();
    const refresh = createExactProductRefresh(store, async (body) =>
      response(body as Request, 'new-hash', 'prod_catalog/saved%3Ablue/wrong-hash'),
    );
    await refresh.refreshProducts(['saved:blue']);
    expect(store.getSnapshot()?.products[0].contentHash).toBe('original');
    expect(refresh.getError()).toMatch(/could not be refreshed/i);
  });

  it('rejects a stale revision after an in-flight preference correction', async () => {
    const store = setup();
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const called = new Promise<void>((resolve) => {
      started = resolve;
    });
    const refresh = createExactProductRefresh(
      store,
      (body) =>
        new Promise((resolve) => {
          const request = body as Request;
          started?.();
          release = () =>
            resolve(response(request, 'new-hash', 'prod_catalog/saved%3Ablue/new-hash'));
        }),
    );
    const pending = refresh.refreshProducts(['saved:blue']);
    await called;
    const correction = await store.transact({
      expectedRevision: 0,
      apply: (current) => ({ ...current, brief: { ...current.brief, revision: 1 } }),
    });
    expect(correction.ok).toBe(true);
    release?.();
    await pending;
    expect(store.getSnapshot()?.products[0].contentHash).toBe('original');
    expect(store.getSnapshot()?.brief.revision).toBe(1);
    expect(refresh.getError()).toMatch(/could not be refreshed/i);
  });
});
