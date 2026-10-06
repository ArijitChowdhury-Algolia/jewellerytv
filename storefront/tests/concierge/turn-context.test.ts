import { describe, expect, it } from 'vitest';
import { applyBriefOperationsV3, createBriefStateV3 } from '../../shared/briefState.js';
import { validateConciergeSession } from '../../shared/concierge/sessionContract.js';
import { buildTurnContext } from '../../src/concierge/turnContext.js';

const encoder = new TextEncoder();
const fact = (index: number, value = `Preference ${index}`) => ({
  type: 'add' as const,
  fact: {
    id: `fact-${index}`,
    field: 'style' as const,
    value: { kind: 'text' as const, text: value },
    scope: { kind: 'mission' as const, key: null },
    strength: 'preference' as const,
    certainty: 'explicit' as const,
    origin: 'ui' as const,
    evidence: { messageId: `message-${index}`, quote: value, explicit: true, verified: true },
  },
});
function session(values: string[]) {
  const brief = applyBriefOperationsV3(createBriefStateV3('mission'), {
    missionId: 'mission',
    expectedRevision: 0,
    turnId: 'accepted-turn',
    operations: values.map((value, index) => fact(index, value)),
  });
  const record = {
    sourceIndex: 'prod_catalog',
    objectID: 'watch-1',
    binding: 'evidence_bound',
    contentHash: 'hash-1',
    evidenceRef: 'ref-1',
    raw: { objectID: 'watch-1' },
    quantity: 1,
    observedAt: null,
  };
  return validateConciergeSession({
    version: 3,
    missionId: 'mission',
    brief,
    products: [
      {
        sourceIndex: 'prod_catalog',
        objectID: 'saved-1',
        binding: 'legacy_unbound',
        contentHash: null,
        evidenceRef: null,
        raw: { objectID: 'saved-1' },
        quantity: 2,
        observedAt: null,
      },
    ],
    selectionRecords: [record],
    compareIds: ['saved-1'],
    combinationIds: ['watch-1'],
    combinationQuantities: { 'watch-1': 2 },
    activeView: 'discover',
    receipts: [],
    committedProposal: {
      missionId: 'mission',
      stateRevision: 1,
      evidenceBatchRevision: 1,
      turnId: 'previous-turn',
      proposalId: 'proposal-1',
      kind: 'product_groups',
      groups: [
        {
          title: 'Most restrained',
          itemSubtotalCents: null,
          lines: [
            {
              evidenceRef: 'ref-1',
              objectID: 'watch-1',
              contentHash: 'hash-1',
              quantity: 1,
              componentSlot: 'watch',
              explanation: 'Compact choice',
              unitPriceCents: null,
              lineSubtotalCents: null,
            },
          ],
        },
      ],
      combinedItemSubtotalCents: null,
      assessment: { perItem: 'unresolved', total: 'unresolved', reasons: [] },
    },
    evidence: [
      {
        evidenceRef: 'ref-1',
        sourceIndex: 'prod_catalog',
        objectID: 'watch-1',
        contentHash: 'hash-1',
      },
    ],
  })!;
}
function decoded(context: Record<string, string>) {
  return JSON.parse(
    Array.from(
      { length: Number(context.shoppingStateChunks) },
      (_, index) => context[`shoppingState${index}`],
    ).join(''),
  );
}

describe('latest-turn shopping context', () => {
  it('retains accepted facts, saved selections and current group identities', () => {
    const context = buildTurnContext(
      session(['blue dial', 'metal bracelet', 'restrained size', 'under $300', 'watch']),
      { page: 'home' },
      { turnId: 'turn-2', sourceMessageId: 'shopper-2' },
    );
    const state = decoded(context);
    expect(state.facts).toHaveLength(5);
    expect(state.factColumns).toBe('id,field,value,scope,strength,certainty,status');
    expect(state.facts[0].slice(3)).toEqual([['m', null], 'p', 'e', 'a']);
    expect(state.saved).toEqual([['saved-1', 2]]);
    expect(state.compareIds).toEqual(['saved-1']);
    expect(state.combination).toEqual([['watch-1', 2]]);
    expect(state.currentGroups).toEqual([['Most restrained', ['watch-1']]]);
    expect(context).toMatchObject({
      page: 'home',
      missionId: 'mission',
      briefRevision: '1',
      turnId: 'turn-2',
    });
    expect(Object.values(context).every((value) => encoder.encode(value).length <= 1024)).toBe(
      true,
    );
    expect(encoder.encode(JSON.stringify(context)).length).toBeLessThanOrEqual(4096);
  });
  it('keeps multibyte preference values intact across chunks', () => {
    const value = '💎'.repeat(200);
    expect(
      decoded(buildTurnContext(session([value]), {}, { turnId: 't', sourceMessageId: 'u' }))
        .facts[0][2].text,
    ).toBe(value);
  });
  it('keeps a long accepted brief and six saves within the bounded field shape', () => {
    const current = session(
      Array.from({ length: 11 }, (_, index) => `Preference ${index}: ${'blue '.repeat(8)}`),
    );
    current.brief.facts.forEach((item, index) => {
      item.id = `call_${'x'.repeat(24)}-fact-${index}`;
    });
    current.products = Array.from({ length: 6 }, (_, index) => ({
      ...current.products[0],
      objectID: `saved-${index}`,
      raw: { objectID: `saved-${index}` },
    }));
    current.compareIds = ['saved-0', 'saved-1'];
    current.activeView = 'compare';
    const context = buildTurnContext(
      current,
      { route: '/' },
      { turnId: `turn-${'x'.repeat(36)}`, sourceMessageId: `shopper-${'x'.repeat(36)}` },
    );
    const state = decoded(context);
    expect(state.facts).toHaveLength(11);
    expect(state.saved).toHaveLength(6);
    expect(state.compareIds).toEqual(['saved-0', 'saved-1']);
    expect(state.activeView).toBe('compare');
    expect(state.currentGroups).toEqual([]);
    expect(encoder.encode(JSON.stringify(context)).length).toBeLessThanOrEqual(4096);
  });
  it('does not reject a valid multi-turn brief solely for exceeding 4 KB total', () => {
    const current = session(
      Array.from({ length: 18 }, (_, index) => `Preference ${index}: ${'blue '.repeat(15)}`),
    );
    current.brief.facts.forEach((item, index) => {
      item.id = `call_${'x'.repeat(24)}-fact-${index}`;
    });
    current.products = Array.from({ length: 6 }, (_, index) => ({
      ...current.products[0],
      objectID: `saved-${index}`,
      raw: { objectID: `saved-${index}` },
    }));
    const context = buildTurnContext(
      current,
      { route: '/' },
      { turnId: `turn-${'x'.repeat(36)}`, sourceMessageId: `shopper-${'x'.repeat(36)}` },
    );
    expect(decoded(context).facts).toHaveLength(18);
    expect(encoder.encode(JSON.stringify(context)).length).toBeGreaterThan(4096);
    expect(Object.values(context).every((value) => encoder.encode(value).length <= 1024)).toBe(
      true,
    );
  });
  it('rejects an oversized brief instead of silently omitting it', () => {
    const current = session(['seed']);
    current.brief.facts = Array.from({ length: 80 }, (_, index) => ({
      ...current.brief.facts[0],
      id: `fact-${index}`,
      value: { kind: 'text' as const, text: 'x'.repeat(400) },
    }));
    expect(() => buildTurnContext(current, {}, { turnId: 't', sourceMessageId: 'u' })).toThrow(
      'exceeds',
    );
  });
});
