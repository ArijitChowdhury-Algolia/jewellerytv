import { describe, expect, it } from 'vitest';
import {
  createSessionPersistence,
  LEGACY_BACKUP_KEY,
  LEGACY_SESSION_KEY,
  V3_SESSION_KEY,
  V3_BACKUP_KEY,
  type StorageLike,
} from '../../src/concierge/sessionPersistence.js';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.data.set(k, v);
  }
}
class FailingV3Storage extends MemoryStorage {
  setItem(key: string, value: string) {
    if (key === V3_SESSION_KEY) throw new Error('disk full');
    super.setItem(key, value);
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
  products: [{ product: { raw: { objectID: 'saved' } }, quantity: 2 }],
  compareIds: ['saved'],
  selectionRecords: [{ objectID: 'saved' }],
});
describe('session persistence boundary', () => {
  it('reads legacy bytes without writing, then backs them up byte-for-byte on first success', () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    const loaded = p.load();
    expect(loaded.state?.brief.version).toBe(3);
    expect(s.writes).toBe(0);
    const result = p.commitMutation((state) => ({
      ...state,
      brief: { ...state.brief, revision: 1 },
    }));
    expect(result.ok).toBe(true);
    expect(s.data.get(LEGACY_BACKUP_KEY)).toBe(legacy);
    expect(JSON.parse(s.data.get(V3_SESSION_KEY)!).products).toHaveLength(1);
  });
  it('backs up exact loose v3 bytes before its first canonical write', () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const seed = createSessionPersistence(s).load().state!;
    s.data.delete(LEGACY_SESSION_KEY);
    const loose = JSON.stringify(
      { ...seed, products: [{ product: { raw: { objectID: 'saved' } }, quantity: 2 }] },
      null,
      2,
    );
    s.data.set(V3_SESSION_KEY, loose);
    const p = createSessionPersistence(s);
    expect(p.load().state?.products).toHaveLength(1);
    expect(s.writes).toBe(0);
    expect(p.commitMutation((state) => state)).toMatchObject({ ok: true });
    expect(s.data.get(V3_BACKUP_KEY)).toBeUndefined();
    expect(p.commitMutation((state) => ({ ...state, brief: { ...state.brief, revision: 1 } }))).toMatchObject({ ok: true });
    expect(s.data.get(V3_BACKUP_KEY)).toBe(loose);
  });
  it('performs zero writes for failed conversion or rejected mutation', () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, 'bad-json');
    const p = createSessionPersistence(s);
    expect(p.load().state).toBeNull();
    expect(p.commitMutation((x) => x)).toMatchObject({ ok: false });
    expect(s.writes).toBe(0);
    const t = new MemoryStorage();
    t.data.set(LEGACY_SESSION_KEY, legacy);
    const q = createSessionPersistence(t);
    expect(
      q.commitMutation(() => {
        throw new Error('reject');
      }),
    ).toMatchObject({ ok: false });
    expect(t.writes).toBe(0);
  });
  it('blocks v1 conversion when any Saved row cannot be migrated instead of dropping it', () => {
    const s = new MemoryStorage();
    const value = JSON.parse(legacy);
    value.products.push({ product: { raw: { title: 'Missing identity' } }, quantity: 1 });
    s.data.set(LEGACY_SESSION_KEY, JSON.stringify(value));
    const p = createSessionPersistence(s);
    expect(p.load().state).toBeNull();
    expect(p.commitMutation((state) => ({ ...state, brief: { ...state.brief, revision: 1 } })))
      .toMatchObject({ ok: false });
    expect(s.data.get(V3_SESSION_KEY)).toBeUndefined();
    expect(s.data.get(LEGACY_BACKUP_KEY)).toBeUndefined();
    expect(s.writes).toBe(0);
  });
  it('blocks canonicalization when a loose v3 Saved row cannot be migrated', () => {
    const s = new MemoryStorage();
    const seed = createSessionPersistence(s, 'm').load().state!;
    const loose = JSON.stringify({
      ...seed,
      products: [...seed.products, { product: { raw: { title: 'Missing identity' } } }],
    });
    s.data.set(V3_SESSION_KEY, loose);
    const p = createSessionPersistence(s);
    expect(p.load().state).toBeNull();
    expect(p.commitMutation((state) => state)).toMatchObject({ ok: false });
    expect(s.data.get(V3_SESSION_KEY)).toBe(loose);
    expect(s.data.get(V3_BACKUP_KEY)).toBeUndefined();
    expect(s.writes).toBe(0);
  });
  it('preserves workspace selections and makes repeated success idempotent', () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    p.commitMutation((state) => ({ ...state, brief: { ...state.brief, revision: 1 } }));
    const writes = s.writes;
    const again = p.commitMutation((state) => state);
    expect(again.ok).toBe(true);
    expect(JSON.parse(s.data.get(V3_SESSION_KEY)!).compareIds).toEqual(['saved']);
    expect(s.writes).toBe(writes);
  });
  it('preserves separate selection records, quantities, and undo history across canonical write and reload', () => {
    const s = new MemoryStorage();
    const seed = createSessionPersistence(s, 'm').load().state!;
    const product = {
      sourceIndex: 'prod_catalog' as const, objectID: 'working', contentHash: null, evidenceRef: null,
      binding: 'legacy_unbound' as const, raw: { objectID: 'working', title: 'Working item' }, quantity: 3, observedAt: null,
    };
    seed.products = [{ ...product, objectID: 'saved', raw: { objectID: 'saved', title: 'Saved item' }, quantity: 2 }];
    seed.selectionRecords = [product];
    seed.compareIds = ['saved', 'working'];
    seed.brief.events = [{ turnId: 'undo-1', revision: 1, beforeFacts: [], beforeTombstones: [] }];
    s.data.set(V3_SESSION_KEY, JSON.stringify(seed));
    const p = createSessionPersistence(s);
    expect(p.commitMutation((state) => ({ ...state, brief: { ...state.brief, revision: 2 } }))).toMatchObject({ ok: true });
    const reloaded = createSessionPersistence(s).load().state!;
    expect(reloaded.products.map((item) => item.objectID)).toEqual(['saved']);
    expect(reloaded.selectionRecords.map((item) => item.objectID)).toEqual(['working']);
    expect(reloaded.compareIds).toEqual(['saved', 'working']);
    expect(reloaded.brief.events).toEqual(seed.brief.events);
  });
  it('rolls back by reading the backup while leaving new v3 data intact', () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    p.commitMutation((state) => ({ ...state, brief: { ...state.brief, revision: 1 } }));
    const v3 = s.data.get(V3_SESSION_KEY);
    const rolled = p.rollback();
    expect(rolled.legacyRaw).toBe(legacy);
    expect(rolled.state?.brief.version).toBe(3);
    expect(s.data.get(V3_SESSION_KEY)).toBe(v3);
  });
  it('fails closed when a newer v3 record is corrupt', () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    s.data.set(V3_SESSION_KEY, 'corrupt-v3');
    const p = createSessionPersistence(s);
    expect(p.load().state).toBeNull();
    expect(p.commitMutation((state) => state)).toMatchObject({
      ok: false,
      reason: 'missing_state',
    });
    expect(s.data.get(V3_SESSION_KEY)).toBe('corrupt-v3');
    expect(s.data.get(LEGACY_BACKUP_KEY)).toBeUndefined();
    expect(s.writes).toBe(0);
  });
  it('does not relabel a foreign-source v3 product as catalogue evidence', () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const seed = createSessionPersistence(s).load().state!;
    s.data.delete(LEGACY_SESSION_KEY);
    s.data.set(
      V3_SESSION_KEY,
      JSON.stringify({
        ...seed,
        products: [{
          sourceIndex: 'blog',
          objectID: 'saved',
          binding: 'legacy_unbound',
          contentHash: null,
          evidenceRef: null,
          raw: { objectID: 'saved' },
          quantity: 1,
          observedAt: null,
        }],
      }),
    );
    const p = createSessionPersistence(s);
    expect(p.load().state).toBeNull();
    expect(s.writes).toBe(0);
  });
  it('fails closed when the outer and brief missions differ', () => {
    const s = new MemoryStorage();
    const value = JSON.parse(legacy);
    value.missionId = 'other';
    s.data.set(LEGACY_SESSION_KEY, JSON.stringify(value));
    expect(createSessionPersistence(s).load().state).toBeNull();
    const v3 = { ...value, version: 3 };
    s.data.set(V3_SESSION_KEY, JSON.stringify(v3));
    expect(createSessionPersistence(s).load().state).toBeNull();
  });
  it('does not write or back up a rejected no-op mutation', () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    expect(p.commitMutation((state) => state)).toMatchObject({ ok: true });
    expect(s.writes).toBe(0);
    expect(s.data.get(V3_SESSION_KEY)).toBeUndefined();
    expect(s.data.get(LEGACY_BACKUP_KEY)).toBeUndefined();
  });
  it('preserves legacy bytes if the v3 write fails after backup', () => {
    const s = new FailingV3Storage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    expect(
      p.commitMutation((state) => ({ ...state, brief: { ...state.brief, revision: 1 } })),
    ).toMatchObject({ ok: false, reason: 'write_failed' });
    expect(s.data.get(LEGACY_SESSION_KEY)).toBe(legacy);
    expect(s.data.get(LEGACY_BACKUP_KEY)).toBe(legacy);
    expect(s.data.get(V3_SESSION_KEY)).toBeUndefined();
  });
  it('awaits applied outcomes and rejects stale outcomes without writing', async () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    const applied = await p.commitAppliedMutation(async (state) => ({
      state: { ...state, brief: { ...state.brief, revision: 1 } },
      result: { status: 'applied' },
    }));
    expect(applied.ok).toBe(true);
    const writes = s.writes;
    const stale = await p.commitAppliedMutation(async (state) => ({
      state: { ...state, brief: { ...state.brief, revision: 99 } },
      result: { status: 'stale_revision' },
    }));
    expect(stale).toMatchObject({ ok: false, reason: 'rejected' });
    expect(s.writes).toBe(writes);
  });
  it('serializes simultaneous applied mutations against the latest revision', async () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    const [a, b] = await Promise.all([
      p.commitAppliedMutation(async (state) => {
        await new Promise((r) => setTimeout(r, 5));
        return {
          state: { ...state, brief: { ...state.brief, revision: 1 } },
          result: { status: 'applied' },
        };
      }),
      p.commitAppliedMutation(async (state) => ({
        state: { ...state, brief: { ...state.brief, revision: state.brief.revision + 1 } },
        result: { status: 'applied' },
      })),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(p.load().state?.brief.revision).toBe(2);
  });
  it('rejects mismatched top-level and brief missions before writing', async () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    expect(p.commitMutation((state) => ({ ...state, missionId: 'other' }))).toMatchObject({
      ok: false,
      reason: 'invalid_mutation',
    });
    expect(s.writes).toBe(0);
    expect(
      await p.commitAppliedMutation(async (state) => ({
        state: { ...state, missionId: 'other' },
        result: { status: 'applied' },
      })),
    ).toMatchObject({ ok: false, reason: 'invalid_mutation' });
    expect(s.writes).toBe(0);
  });
  it('rejects an applied mutation with invalid selection identity before writing', async () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    const result = await p.commitAppliedMutation(async (state) => ({
      state: { ...state, compareIds: ['missing-product'] },
      result: { status: 'applied' },
    }));
    expect(result).toMatchObject({ ok: false, reason: 'invalid_mutation' });
    expect(s.writes).toBe(0);
  });
  it('supports a fresh tab with no keys and writes only after an applied mutation', async () => {
    const s = new MemoryStorage();
    const p = createSessionPersistence(s, 'fresh-mission');
    const rejected = await p.commitAppliedMutation(async (state) => ({
      state: { ...state, brief: { ...state.brief, revision: 1 } },
      result: { status: 'stale_revision' },
    }));
    expect(rejected).toMatchObject({ ok: false, reason: 'rejected' });
    expect(s.writes).toBe(0);
    const applied = await p.commitAppliedMutation(async (state) => ({
      state: { ...state, brief: { ...state.brief, revision: 1 } },
      result: { status: 'applied' },
    }));
    expect(applied.ok).toBe(true);
    expect(s.getItem(V3_SESSION_KEY)).not.toBeNull();
    expect(s.getItem(LEGACY_BACKUP_KEY)).toBeNull();
  });
  it('starts a fresh mission while retaining saved products and exact legacy backup bytes', async () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    const p = createSessionPersistence(s);
    const result = await p.resetMission('fresh-mission');
    expect(result).toMatchObject({ ok: true });
    expect(s.getItem(LEGACY_SESSION_KEY)).toBe(legacy);
    expect(s.getItem(LEGACY_BACKUP_KEY)).toBe(legacy);
    const next = JSON.parse(s.getItem(V3_SESSION_KEY)!);
    expect(next.missionId).toBe('fresh-mission');
    expect(next.brief.missionId).toBe('fresh-mission');
    expect(next.products).toHaveLength(1);
    expect(next.compareIds).toEqual([]);
    expect(next.selectionRecords).toEqual([]);
  });
  it('does not overwrite a corrupt v3 record when starting a new mission', async () => {
    const s = new MemoryStorage();
    s.data.set(LEGACY_SESSION_KEY, legacy);
    s.data.set(V3_SESSION_KEY, 'corrupt-v3');
    const p = createSessionPersistence(s);
    expect(await p.resetMission('fresh-mission')).toMatchObject({
      ok: false,
      reason: 'corrupt_state',
    });
    expect(s.getItem(V3_SESSION_KEY)).toBe('corrupt-v3');
    expect(s.getItem(LEGACY_BACKUP_KEY)).toBeNull();
    expect(s.writes).toBe(0);
  });
});
