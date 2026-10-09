import { describe, expect, it } from 'vitest';
import {
  validateConciergeSession,
  type SourceBoundProduct,
} from '../../shared/concierge/sessionContract.js';
import {
  createSessionPersistence,
  LEGACY_SESSION_KEY,
  LEGACY_BACKUP_KEY,
  V3_SESSION_KEY,
} from '../../src/concierge/sessionPersistence.js';

class Memory {
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
const brief = (m = 'm') => ({
  version: 2,
  missionId: m,
  revision: 0,
  facts: [],
  processedTurns: [],
  tombstones: [],
  events: [],
});
const v1 = () =>
  JSON.stringify({
    version: 1,
    missionId: 'm',
    brief: brief(),
    products: [
      {
        product: {
          raw: { objectID: 'saved-1', title: 'Saved ring', image: 'img', Pricing_ActivePrice: 99 },
        },
        quantity: 2,
        observedAt: '2026-10-06',
      },
    ],
    selectionRecords: [],
    compareIds: ['saved-1'],
  });
describe('v3 session contract RED gates', () => {
  it('migrates a pinned v1 Saved record without writes or invented evidence', () => {
    const s = new Memory();
    const raw = v1();
    s.values.set(LEGACY_SESSION_KEY, raw);
    const p = createSessionPersistence(s, 'm');
    const loaded = p.load();
    expect(loaded.state).not.toBeNull();
    const migrated = loaded.state as unknown as { products: Array<Record<string, unknown>> };
    expect(migrated.products).toHaveLength(1);
    expect(migrated.products[0]).toMatchObject({
      objectID: 'saved-1',
      quantity: 2,
      observedAt: '2026-10-06',
      raw: { title: 'Saved ring' },
    });
    expect(s.writes).toBe(0);
  });
  it('backs up exact v1 bytes on first successful v3 mutation', () => {
    const s = new Memory();
    const raw = v1();
    s.values.set(LEGACY_SESSION_KEY, raw);
    const p = createSessionPersistence(s, 'm');
    const loaded = p.load().state!;
    p.commitMutation((state) => ({ ...state, brief: { ...state.brief, revision: 1 } }));
    expect(s.values.get(LEGACY_BACKUP_KEY)).toBe(raw);
    expect(s.values.get(V3_SESSION_KEY)).toBeTruthy();
    expect(loaded.products).toHaveLength(1);
  });
  const base = () => ({
    version: 3,
    missionId: 'm',
    brief: {
      version: 3,
      missionId: 'm',
      revision: 0,
      facts: [],
      processedTurns: [],
      tombstones: [],
      events: [],
    },
    products: [],
    selectionRecords: [],
    compareIds: [],
    activeView: 'discover',
    receipts: [],
    committedProposal: null,
  });
  const boundProduct = (objectID: string, evidenceRef = `ref-${objectID}`) => ({
    sourceIndex: 'prod_catalog' as const,
    objectID,
    contentHash: `hash-${objectID}`,
    evidenceRef,
    binding: 'evidence_bound' as const,
    raw: { objectID, Catalog_TitleDescription: `Product ${objectID}` },
    quantity: 1,
    observedAt: '2026-10-06T12:00:00.000Z',
  });
  const legacyProduct = (objectID: string) => ({
    sourceIndex: 'prod_catalog' as const,
    objectID,
    contentHash: null,
    evidenceRef: null,
    binding: 'legacy_unbound' as const,
    raw: { objectID, Catalog_TitleDescription: `Legacy ${objectID}` },
    quantity: 1,
    observedAt: null,
  });
  const proposalFor = (product: ReturnType<typeof boundProduct>) => ({
    missionId: 'm',
    stateRevision: 0,
    evidenceBatchRevision: 1,
    turnId: 'turn-1',
    proposalId: 'proposal-1',
    kind: 'product_groups' as const,
    groups: [
      {
        title: 'Selected for you',
        lines: [
          {
            evidenceRef: product.evidenceRef,
            objectID: product.objectID,
            contentHash: product.contentHash,
            quantity: 1,
            componentSlot: 'main',
            explanation: 'Matches the accepted brief',
            unitPriceCents: 12999,
            lineSubtotalCents: 12999,
          },
        ],
        itemSubtotalCents: null,
      },
    ],
    combinedItemSubtotalCents: null,
    assessment: { perItem: 'accepted' as const, total: 'accepted' as const, reasons: [] },
  });
  it('accepts unsaved evidence-bound selections for Compare', () => {
    const selected = boundProduct('selected-1');
    const parsed = validateConciergeSession({
      ...base(),
      selectionRecords: [selected],
      compareIds: ['selected-1'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.products).toEqual([]);
    expect(parsed?.selectionRecords).toEqual([selected]);
  });
  it('requires raw object identity for legacy-unbound products', () => {
    const legacy = { ...legacyProduct('saved-1'), raw: { objectID: 'other' } };
    expect(validateConciergeSession({ ...base(), products: [legacy] })).toBeNull();
  });
  it('accepts the complete staged presentation and preserves render fields', () => {
    const selected = boundProduct('selected-1');
    const proposal = proposalFor(selected);
    const parsed = validateConciergeSession({
      ...base(),
      selectionRecords: [selected],
      committedProposal: proposal,
    });
    expect(parsed?.committedProposal).toEqual(proposal);
    expect(parsed?.committedProposal?.groups[0].lines[0].explanation).toBe(
      'Matches the accepted brief',
    );
  });
  it('requires every committed line to resolve to the exact evidence-bound raw product', () => {
    const selected = boundProduct('selected-1');
    const proposal = proposalFor(selected);
    expect(validateConciergeSession({ ...base(), committedProposal: proposal })).toBeNull();
    expect(
      validateConciergeSession({
        ...base(),
        selectionRecords: [legacyProduct('selected-1')],
        committedProposal: proposal,
      }),
    ).toBeNull();
    expect(
      validateConciergeSession({
        ...base(),
        selectionRecords: [{ ...selected, contentHash: 'different' }],
        committedProposal: proposal,
      }),
    ).toBeNull();
  });
  it('keeps committed presentation groups within the approved three-group limit', () => {
    const selected = boundProduct('selected-1');
    const proposal = proposalFor(selected);
    expect(
      validateConciergeSession({
        ...base(),
        selectionRecords: [selected],
        committedProposal: {
          ...proposal,
          groups: Array.from({ length: 4 }, (_, index) => ({
            ...proposal.groups[0],
            title: `Group ${index + 1}`,
          })),
        },
      }),
    ).toBeNull();
  });
  it('declares the same discriminated product fields that runtime validation requires', () => {
    const bound: SourceBoundProduct = boundProduct('bound');
    const legacy: SourceBoundProduct = legacyProduct('legacy');
    expect(bound.binding).toBe('evidence_bound');
    expect(bound.raw.objectID).toBe('bound');
    expect(legacy.binding).toBe('legacy_unbound');
    expect(legacy.contentHash).toBeNull();
  });
  it.each([
    [
      'blog source',
      {
        sourceIndex: 'blog',
        objectID: 'x',
        contentHash: 'h',
        evidenceRef: 'e',
        binding: 'evidence_bound',
        raw: { objectID: 'x' },
        quantity: 1,
        observedAt: '',
      },
    ],
    [
      'missing hash',
      {
        sourceIndex: 'prod_catalog',
        objectID: 'x',
        contentHash: null,
        evidenceRef: null,
        binding: 'evidence_bound',
        raw: { objectID: 'x' },
        quantity: 1,
        observedAt: '',
      },
    ],
    [
      'raw mismatch',
      {
        sourceIndex: 'prod_catalog',
        objectID: 'x',
        contentHash: 'h',
        evidenceRef: 'e',
        binding: 'evidence_bound',
        raw: { objectID: 'other' },
        quantity: 1,
        observedAt: '',
      },
    ],
    [
      'quantity zero',
      {
        sourceIndex: 'prod_catalog',
        objectID: 'x',
        contentHash: 'h',
        evidenceRef: 'e',
        binding: 'evidence_bound',
        raw: { objectID: 'x' },
        quantity: 0,
        observedAt: '',
      },
    ],
    [
      'quantity eleven',
      {
        sourceIndex: 'prod_catalog',
        objectID: 'x',
        contentHash: 'h',
        evidenceRef: 'e',
        binding: 'evidence_bound',
        raw: { objectID: 'x' },
        quantity: 11,
        observedAt: '',
      },
    ],
  ])('rejects %s product records', (_name, product) =>
    expect(validateConciergeSession({ ...base(), products: [product] })).toBeNull(),
  );
  it('rejects duplicate IDs, over-cap Saved, invalid view, malformed receipt, and unknown committed evidence', () => {
    const p = {
      sourceIndex: 'prod_catalog',
      objectID: 'x',
      contentHash: 'h',
      evidenceRef: 'e',
      binding: 'evidence_bound',
      raw: { objectID: 'x' },
      quantity: 1,
      observedAt: '',
    };
    expect(validateConciergeSession({ ...base(), products: [p, p] })).toBeNull();
    expect(
      validateConciergeSession({
        ...base(),
        products: Array.from({ length: 13 }, (_, i) => ({
          ...p,
          objectID: String(i),
          raw: { objectID: String(i) },
        })),
      }),
    ).toBeNull();
    expect(validateConciergeSession({ ...base(), activeView: 'bad' })).toBeNull();
    expect(validateConciergeSession({ ...base(), receipts: [{ bad: true }] })).toBeNull();
    expect(
      validateConciergeSession({
        ...base(),
        committedProposal: { proposalId: 'p', evidenceRefs: ['unknown'] },
      }),
    ).toBeNull();
  });
  it('reloads and resets a migrated date-only Saved observation without losing it', async () => {
    const s = new Memory();
    s.values.set(LEGACY_SESSION_KEY, v1());
    const p = createSessionPersistence(s, 'm');
    const selected = boundProduct('selected-reset');
    p.commitMutation((state) => ({
      ...state,
      selectionRecords: [selected],
      committedProposal: proposalFor(selected),
      evidence: [
        {
          evidenceRef: selected.evidenceRef,
          sourceIndex: selected.sourceIndex,
          objectID: selected.objectID,
          contentHash: selected.contentHash,
        },
      ],
    }));
    const reloaded = createSessionPersistence(s, 'm');
    const reloadedState = validateConciergeSession(reloaded.load().state);
    expect(reloadedState?.products[0]).toMatchObject({
      objectID: 'saved-1',
      observedAt: '2026-10-06',
    });
    const reset = await reloaded.resetMission('new');
    expect(reset.ok).toBe(true);
    if (reset.ok) {
      const resetState = validateConciergeSession(reset.state);
      expect(resetState?.products).toHaveLength(1);
      expect(resetState?.committedProposal).toBeNull();
      expect(resetState?.evidence).toEqual([]);
    }
  });
});
