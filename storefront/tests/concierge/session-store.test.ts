import { describe, expect, it } from 'vitest';
import { createSessionStore } from '../../src/concierge/sessionStore.js';
import { LEGACY_SESSION_KEY, V3_SESSION_KEY, type StorageLike } from '../../src/concierge/sessionPersistence.js';
class Memory implements StorageLike {
  values = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.values.set(k, v);
  }
}
class FailingMemory extends Memory {
  setItem(k: string, v: string) {
    if (k === V3_SESSION_KEY) throw new Error('disk full');
    super.setItem(k, v);
  }
}
const legacy = JSON.stringify({
  version: 1,
  missionId: 'm',
  brief: {
    version: 2,
    missionId: 'm',
    revision: 0,
    facts: [],
    processedTurns: [],
    tombstones: [],
    events: [],
  },
  products: [
    {
      product: { raw: { objectID: 'saved', title: 'Saved' } },
      quantity: 2,
      observedAt: '2026-10-06',
    },
  ],
  selectionRecords: [],
  compareIds: ['saved'],
  combinationIds: ['saved'],
  combinationQuantities: { saved: 2 },
});
describe('canonical session store', () => {
  it('keeps snapshot identity stable and notifies only after accepted transaction', async () => {
    const s = new Memory();
    const store = createSessionStore(s, 'm');
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    let calls = 0;
    store.subscribe(() => calls++);
    const rejected = await store.transact({ expectedRevision: 99, apply: (state) => state });
    expect(rejected.ok).toBe(false);
    expect(store.getSnapshot()).toBe(first);
    expect(calls).toBe(0);
    const applied = await store.transact({
      expectedRevision: 0,
      apply: (state) => ({ ...state, brief: { ...state.brief, revision: 1 } }),
    });
    expect(applied.ok).toBe(true);
    expect(calls).toBe(1);
    expect(store.getSnapshot()).not.toBe(first);
  });
  it('migrates v1 Saved and reset retains it while clearing working state', async () => {
    const s = new Memory();
    s.values.set(LEGACY_SESSION_KEY, legacy);
    const store = createSessionStore(s, 'm');
    expect(store.getSnapshot()?.products).toHaveLength(1);
    const reset = await store.resetMission('new');
    expect(reset.ok).toBe(true);
    expect(store.getSnapshot()?.products).toHaveLength(1);
    expect(store.getSnapshot()?.compareIds).toEqual([]);
  });
  it('serializes concurrent transactions against latest revision', async () => {
    const s = new Memory();
    const store = createSessionStore(s, 'm');
    const [a, b] = await Promise.all([
      store.transact({
        expectedRevision: 0,
        apply: async (state) => {
          await new Promise((r) => setTimeout(r, 5));
          return { ...state, brief: { ...state.brief, revision: 1 } };
        },
      }),
      store.transact({
        expectedRevision: 0,
        apply: (state) => ({ ...state, brief: { ...state.brief, revision: 1 } }),
      }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
  it('keeps the published snapshot and listeners unchanged after a failed write', async () => {
    const s = new FailingMemory();
    const store = createSessionStore(s, 'm');
    const before = store.getSnapshot();
    let calls = 0;
    store.subscribe(() => calls++);
    const result = await store.transact({
      expectedRevision: 0,
      apply: (state) => ({ ...state, brief: { ...state.brief, revision: 1 } }),
    });
    expect(result).toMatchObject({ ok: false, reason: 'write_failed' });
    expect(store.getSnapshot()).toBe(before);
    expect(calls).toBe(0);
    expect(s.getItem(V3_SESSION_KEY)).toBeNull();
  });
});
