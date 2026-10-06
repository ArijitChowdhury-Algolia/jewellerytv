import { describe, expect, it, vi } from 'vitest';
import { createConciergeToolRuntime } from '../../src/concierge/toolRuntime';
import { createSessionStore } from '../../src/concierge/sessionStore';
import type { RetrieveEvidenceResult } from '../../shared/concierge/retrieval/types';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const shopper = { id: 'message-1', text: 'Please show me a ring under $100.' };
const stateInput = {
  missionId: 'mission-1',
  expectedRevision: 0,
  operationId: 'operation-1',
  sourceMessageId: shopper.id,
  operations: [
    {
      action: 'add',
      factIds: [],
      sourceQuote: 'a ring',
      fact: {
        id: 'type-ring',
        field: 'product_type',
        value: {
          kind: 'facet',
          attribute: 'Catalog_ProductType',
          values: ['Ring'],
          operator: 'any',
        },
        scope: { kind: 'mission', key: null },
        strength: 'requirement',
        certainty: 'explicit',
      },
    },
  ],
};
const retrievalInput = {
  source: 'prod_catalog',
  query: 'ring',
  count: 3,
  missionId: 'mission-1',
  expectedRevision: 1,
  turnId: 'turn-1',
  target: { kind: 'item', itemKey: 'Ring', productType: 'Ring' },
};
const record = {
  objectID: 'ring-1',
  Catalog_TitleDescription: 'Silver ring',
  Catalog_ProductType: 'Ring',
  Pricing_ActivePrice: 89.99,
};
const evidence = {
  source: 'prod_catalog' as const,
  objectID: 'ring-1',
  contentHash: 'hash-1',
  evidenceRef: 'prod_catalog/ring-1/hash-1',
  retrievedAt: '2026-10-06T00:00:00Z',
  record,
};

describe('API-only Concierge client tool runtime', () => {
  it('persists a refreshed displayed product that was already saved', async () => {
    const storage = memoryStorage();
    const sessionStore = createSessionStore(storage, 'mission-1');
    const runtime = createConciergeToolRuntime({
      storage,
      sessionStore,
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async () => ({
        status: 'ok',
        source: 'prod_catalog',
        missionId: 'mission-1',
        revision: 1,
        expectedRevision: 1,
        turnId: 'turn-1',
        effectiveFilters: [],
        unresolved: [],
        records: [evidence],
      }),
    });
    await runtime.update(stateInput);
    const saved = {
      sourceIndex: 'prod_catalog' as const,
      objectID: 'ring-1',
      raw: record,
      quantity: 1,
      observedAt: '2026-10-05T00:00:00Z',
      binding: 'evidence_bound' as const,
      contentHash: 'older',
      evidenceRef: 'prod_catalog/ring-1/older',
    };
    const seeded = await sessionStore.transact({
      expectedRevision: 1,
      apply: (current) => ({
        ...current,
        products: [saved],
        selectionRecords: [saved],
      }),
    });
    expect(seeded.ok).toBe(true);
    runtime.beginTurn('turn-1', shopper.id);
    expect((await runtime.retrieve(retrievalInput)).status).toBe('ok');
    expect(
      (
        await runtime.presentSemantic(
          {
            body: {
              kind: 'product_groups',
              groups: [
                {
                  basis: { attribute: 'Catalog_ProductType', value: 'Ring' },
                  items: [
                    {
                      evidenceRef: evidence.evidenceRef,
                      quantity: 1,
                      componentSlot: 'ring',
                      explanation: 'Useful',
                    },
                  ],
                },
              ],
              alternatives: null,
            },
          },
          'tool-call-refresh',
        )
      ).status,
    ).toBe('staged');
    expect(await runtime.finishTurnAndPersist('turn-1', 'completed')).not.toBeNull();
    const persisted = sessionStore.getSnapshot();
    expect(persisted?.committedProposal?.groups[0].lines[0].objectID).toBe('ring-1');
    expect(persisted?.selectionRecords[0]).toEqual(persisted?.products[0]);
  });
  it('decorates semantic presentation with authoritative turn and evidence identities', async () => {
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async () => ({
        status: 'ok',
        source: 'prod_catalog',
        missionId: 'mission-1',
        revision: 1,
        expectedRevision: 1,
        turnId: 'turn-1',
        effectiveFilters: [],
        unresolved: [],
        records: [evidence],
      }),
    });
    await runtime.update(stateInput);
    runtime.beginTurn('turn-1', shopper.id);
    expect(runtime.hadPresentationAttempt()).toBe(false);
    const rr = await runtime.retrieve(retrievalInput);
    expect(rr.status).toBe('ok');
    const result = await runtime.presentSemantic(
      {
        body: {
          kind: 'product_groups',
          groups: [
            {
              basis: { attribute: 'Catalog_ProductType', value: 'Ring' },
              items: [
                {
                  evidenceRef: evidence.evidenceRef,
                  quantity: 1,
                  componentSlot: 'ring',
                  explanation: 'Useful',
                },
              ],
            },
          ],
          alternatives: null,
        },
      },
      'tool-call-1',
    );
    expect(runtime.hadPresentationAttempt()).toBe(true);
    expect(result.status).toBe('staged');
    if (result.status === 'staged' && 'proposal' in result) {
      expect(result.proposal.missionId).toBe('mission-1');
      expect(result.proposal.turnId).toBe('turn-1');
      expect(result.proposal.proposalId).toBe('tool-call-1');
      expect(result.proposal.groups[0].lines[0].objectID).toBe('ring-1');
    }
    const rejected = await runtime.presentSemantic(
      {
        body: {
          kind: 'product_groups',
          groups: [
            {
              basis: { attribute: 'Catalog_ProductType', value: 'Ring' },
              items: [
                {
                  evidenceRef: 'missing',
                  quantity: 1,
                  componentSlot: 'ring',
                  explanation: 'Useful',
                },
              ],
            },
          ],
          alternatives: null,
        },
      },
      'tool-call-2',
    );
    expect(rejected.status).toBe('invalid_evidence');
    expect(runtime.getPublished()).toBeNull();
  });
  it('retrieves semantic requests with trusted turn identity and rejects inactive/blog targets', async () => {
    const calls: unknown[] = [];
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async (body) => {
        calls.push(body);
        return {
          status: 'ok',
          source: body.input.source,
          missionId: body.input.missionId,
          revision: body.input.expectedRevision,
          expectedRevision: body.input.expectedRevision,
          turnId: body.input.turnId,
          effectiveFilters: [],
          unresolved: [],
          records: [],
        };
      },
    });
    expect(
      (
        await runtime.retrieveSemantic(
          {
            source: 'prod_catalog',
            query: 'rings',
            count: 2,
            target: { kind: 'item', itemKey: 'Ring', productType: 'Ring' },
          },
          'call',
        )
      ).status,
    ).toBe('invalid_input');
    runtime.beginTurn('turn-1', shopper.id);
    const result = await runtime.retrieveSemantic(
      {
        source: 'prod_catalog',
        query: 'rings',
        count: 2,
        target: { kind: 'item', itemKey: 'Ring', productType: 'Ring' },
      },
      'call',
    );
    expect(result.status).toBe('ok');
    expect(
      (calls[0] as { input: { missionId: string; expectedRevision: number; turnId: string } })
        .input,
    ).toMatchObject({ missionId: 'mission-1', expectedRevision: 0, turnId: 'turn-1' });
    expect(
      (
        await runtime.retrieveSemantic(
          {
            source: 'blog',
            query: 'guide',
            count: 1,
            target: { kind: 'item', itemKey: 'Ring', productType: 'Ring' },
          },
          'blog',
        )
      ).status,
    ).toBe('invalid_input');
  });
  it('injects state-update identity and replays one semantic tool call without a duplicate fact', async () => {
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async () => {
        throw new Error('No retrieval expected');
      },
    });
    const factWithoutId: Record<string, unknown> = { ...stateInput.operations[0].fact };
    delete factWithoutId.id;
    const semantic = {
      operations: [{ ...stateInput.operations[0], fact: factWithoutId }],
    };
    runtime.beginTurn('turn-1', shopper.id);
    const applied = await runtime.updateSemantic(semantic, 'tool-call-1');
    expect(applied.status).toBe('applied');
    expect(runtime.getSession()?.brief.facts[0].id).toBe('tool-call-1-fact-0');
    expect(runtime.getSession()?.brief.revision).toBe(1);
    expect((await runtime.updateSemantic(semantic, 'tool-call-1')).status).toBe('applied');
    expect(runtime.getSession()?.brief.facts).toHaveLength(1);
    expect(
      (
        await runtime.updateSemantic(
          { operations: [{ ...semantic.operations[0], sourceQuote: 'different quote' }] },
          'tool-call-1',
        )
      ).status,
    ).toBe('operation_conflict');
    expect((await runtime.updateSemantic({ operations: [] }, 'empty')).status).toBe(
      'invalid_input',
    );
  });
  it('rejects semantic callbacks after turn completion or manual invalidation', async () => {
    const search = vi.fn(async () => {
      throw new Error('Search must not run');
    });
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: search,
    });
    runtime.beginTurn('turn-1', shopper.id);
    const oldToken = runtime.getActiveTurnToken();
    expect(runtime.notePresentationAttempt(oldToken!)).toBe(true);
    expect(runtime.hadPresentationAttempt()).toBe(true);
    expect(runtime.endTurn('wrong-turn')).toBe(false);
    expect(runtime.endTurn('turn-1')).toBe(true);
    expect(
      (
        await runtime.retrieveSemantic(
          { source: 'prod_catalog', query: 'ring', count: 2, target: null },
          'call-1',
        )
      ).status,
    ).toBe('invalid_input');
    runtime.beginTurn('turn-2', shopper.id);
    expect(runtime.hadPresentationAttempt()).toBe(false);
    expect(runtime.notePresentationAttempt(oldToken!)).toBe(false);
    expect(
      (
        await runtime.retrieveSemantic(
          { source: 'prod_catalog', query: 'ring', count: 2, target: null },
          'late-call',
          undefined,
          oldToken!,
        )
      ).status,
    ).toBe('stale_revision');
    runtime.invalidateTurn();
    expect(
      (await runtime.updateSemantic({ operations: stateInput.operations }, 'call-2')).status,
    ).toBe('invalid_input');
    expect(search).not.toHaveBeenCalled();
    expect(runtime.getSession()?.brief.revision).toBe(0);
  });
  it('updates the one brief, retrieves with the accepted snapshot, then stages Concierge-selected evidence', async () => {
    const storage = memoryStorage();
    const calls: unknown[] = [];
    const runtime = createConciergeToolRuntime({
      storage,
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async (body) => {
        calls.push(body);
        return {
          status: 'ok',
          source: 'prod_catalog',
          missionId: 'mission-1',
          revision: 1,
          expectedRevision: 1,
          turnId: 'turn-1',
          effectiveFilters: [],
          unresolved: [],
          records: [evidence],
        };
      },
    });
    expect((await runtime.update(stateInput)).status).toBe('applied');
    const retrieved = await runtime.retrieve(retrievalInput);
    expect(retrieved.status).toBe('ok');
    expect(calls[0]).toMatchObject({
      input: retrievalInput,
      brief: { missionId: 'mission-1', revision: 1 },
    });
    const chosen = await runtime.present({
      missionId: 'mission-1',
      expectedStateRevision: 1,
      expectedEvidenceBatchRevision: retrieved.evidenceBatchRevision,
      turnId: 'turn-1',
      proposalId: 'proposal-1',
      body: {
        kind: 'product_groups',
        alternatives: null,
        groups: [
          {
            basis: { attribute: 'Catalog_ProductType', value: 'Ring' },
            items: [
              {
                evidenceRef: evidence.evidenceRef,
                objectID: 'ring-1',
                contentHash: 'hash-1',
                quantity: 1,
                componentSlot: 'ring',
                explanation: 'A smaller setting',
              },
            ],
          },
        ],
      },
    });
    expect(chosen.status).toBe('staged');
    if ('proposal' in chosen && chosen.proposal)
      expect(chosen.proposal.assessment.total).toBe('unresolved');
    expect(runtime.finishTurn('turn-1', 'aborted')).toBeNull();
    expect(runtime.getPublished()).toBeNull();
  });

  it('commits a staged proposal once only after successful terminal completion', async () => {
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async () => ({
        status: 'ok',
        source: 'prod_catalog',
        missionId: 'mission-1',
        revision: 1,
        expectedRevision: 1,
        turnId: 'turn-1',
        effectiveFilters: [],
        unresolved: [],
        records: [evidence],
      }),
    });
    await runtime.update(stateInput);
    const retrieved = await runtime.retrieve(retrievalInput);
    await runtime.present({
      missionId: 'mission-1',
      expectedStateRevision: 1,
      expectedEvidenceBatchRevision: retrieved.evidenceBatchRevision,
      turnId: 'turn-1',
      proposalId: 'proposal-1',
      body: {
        kind: 'product_groups',
        alternatives: null,
        groups: [
          {
            basis: { attribute: 'Catalog_ProductType', value: 'Ring' },
            items: [
              {
                evidenceRef: evidence.evidenceRef,
                objectID: 'ring-1',
                contentHash: 'hash-1',
                quantity: 1,
                componentSlot: 'ring',
                explanation: 'A smaller setting',
              },
            ],
          },
        ],
      },
    });
    expect(runtime.finishTurn('turn-1', 'completed')?.proposalId).toBe('proposal-1');
    expect(runtime.finishTurn('turn-1', 'completed')).toBeNull();
  });

  it('discards a late retrieval after a manual revision change', async () => {
    let complete!: (value: RetrieveEvidenceResult) => void;
    const pending = new Promise<RetrieveEvidenceResult>((resolve) => {
      complete = resolve;
    });
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: () => pending,
    });
    await runtime.update(stateInput);
    const request = runtime.retrieve(retrievalInput);
    await runtime.update({
      ...stateInput,
      expectedRevision: 1,
      operationId: 'operation-2',
      operations: [
        {
          ...stateInput.operations[0],
          fact: { ...stateInput.operations[0].fact, id: 'type-ring-2' },
        },
      ],
    });
    complete({
      status: 'ok',
      source: 'prod_catalog',
      missionId: 'mission-1',
      revision: 1,
      expectedRevision: 1,
      turnId: 'turn-1',
      effectiveFilters: [],
      unresolved: [],
      records: [evidence],
    });
    expect((await request).status).toBe('stale_revision');
  });

  it('rejects a mismatched source before exposing records to the Concierge', async () => {
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async () => ({
        status: 'ok',
        source: 'blog',
        missionId: 'mission-1',
        revision: 1,
        expectedRevision: 1,
        turnId: 'turn-1',
        effectiveFilters: [],
        unresolved: [],
        records: [{ ...evidence, source: 'blog' }],
      }),
    });
    await runtime.update(stateInput);
    expect((await runtime.retrieve(retrievalInput)).status).toBe('invalid_evidence');
    expect(runtime.getPublished()).toBeNull();
  });

  it('keeps a cancelled state callback write-free', async () => {
    const storage = memoryStorage();
    const controller = new AbortController();
    controller.abort();
    const runtime = createConciergeToolRuntime({
      storage,
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async () => {
        throw new Error('unused');
      },
    });
    expect((await runtime.update(stateInput, controller.signal)).status).toBe('aborted');
    expect(storage.values.size).toBe(0);
    expect(runtime.getSession()?.brief.revision).toBe(0);
  });
  it('ignores an in-flight retrieval after a new mission starts', async () => {
    let complete!: (value: RetrieveEvidenceResult) => void;
    const pending = new Promise<RetrieveEvidenceResult>((resolve) => {
      complete = resolve;
    });
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: () => pending,
    });
    const request = runtime.retrieve({
      ...retrievalInput,
      expectedRevision: 0,
      missionId: 'mission-1',
    });
    const reset = await runtime.resetMission('mission-2');
    expect(reset.ok).toBe(true);
    complete({
      status: 'ok',
      source: 'prod_catalog',
      missionId: 'mission-1',
      revision: 0,
      expectedRevision: 0,
      turnId: 'turn-1',
      effectiveFilters: [],
      unresolved: [],
      records: [evidence],
    });
    expect((await request).status).toBe('aborted');
    expect(runtime.getSession()?.missionId).toBe('mission-2');
    expect(runtime.getPublished()).toBeNull();
  });

  it.each([
    ['Necklace', 79.99],
    ['Bracelet', 59.99],
  ])('verifies a standalone %s line for a complete look', async (productType, price) => {
    const sourceRecord = {
      objectID: `${productType.toLowerCase()}-standalone`,
      Catalog_TitleDescription: `Plain ${productType}`,
      Catalog_ProductType: productType,
      Pricing_ActivePrice: price,
    };
    const sourceEvidence = { ...evidence, objectID: sourceRecord.objectID, record: sourceRecord };
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async () => ({
        status: 'ok' as const,
        source: 'prod_catalog' as const,
        missionId: 'mission-1',
        revision: 1,
        expectedRevision: 1,
        turnId: 'turn-1',
        effectiveFilters: [],
        unresolved: [],
        records: [sourceEvidence],
      }),
    });
    await runtime.update(stateInput);
    runtime.beginTurn('turn-1', shopper.id);
    const retrieved = await runtime.retrieve({
      ...retrievalInput,
      query: productType.toLowerCase(),
      target: { kind: 'item', itemKey: productType, productType },
    });
    expect(retrieved.status).toBe('ok');
    const result = await runtime.present({
      missionId: 'mission-1',
      expectedStateRevision: 1,
      expectedEvidenceBatchRevision: retrieved.evidenceBatchRevision,
      turnId: 'turn-1',
      proposalId: 'complete-look',
      body: {
        kind: 'complete_looks',
        groups: null,
        alternatives: [
          {
            title: 'Standalone piece',
            lines: [
              {
                evidenceRef: sourceEvidence.evidenceRef,
                objectID: sourceEvidence.objectID,
                contentHash: sourceEvidence.contentHash,
                quantity: 1,
                componentSlot: productType.toLowerCase(),
                explanation: 'Standalone catalogue item',
              },
            ],
          },
        ],
      },
    });
    expect(result.status).toBe('staged');
    if (result.status === 'staged' && 'proposal' in result) {
      expect(result.proposal.assessment.reasons).not.toContain(
        `${sourceRecord.objectID}:packaged_contents`,
      );
      expect(result.proposal.groups[0].lines[0].unitPriceCents).toBe(Math.round(price * 100));
      expect(result.proposal.groups[0].lines[0].lineSubtotalCents).toBe(Math.round(price * 100));
    }
  });

  it.each([
    ['Earrings', { Catalog_TitleDescription: 'Sterling silver earrings' }],
    ['Pendant', { Catalog_TitleDescription: 'Pendant with unclear chain contents' }],
    ['Jewelry Set', { Catalog_TitleDescription: 'Pendant and earring set' }],
    ['Necklace', { Catalog_TitleDescription: 'Necklace and earring set' }],
  ])('leaves ambiguous %s contents unresolved', async (productType, extra) => {
    const sourceRecord = {
      objectID: `${productType.toLowerCase().replaceAll(' ', '-')}-ambiguous`,
      ...extra,
      Catalog_ProductType: productType,
      Pricing_ActivePrice: 49.99,
    };
    const sourceEvidence = { ...evidence, objectID: sourceRecord.objectID, record: sourceRecord };
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async () => ({
        status: 'ok' as const,
        source: 'prod_catalog' as const,
        missionId: 'mission-1',
        revision: 1,
        expectedRevision: 1,
        turnId: 'turn-1',
        effectiveFilters: [],
        unresolved: [],
        records: [sourceEvidence],
      }),
    });
    await runtime.update(stateInput);
    runtime.beginTurn('turn-1', shopper.id);
    const retrieved = await runtime.retrieve({
      ...retrievalInput,
      query: productType,
      target: null,
    });
    const result = await runtime.present({
      missionId: 'mission-1',
      expectedStateRevision: 1,
      expectedEvidenceBatchRevision: retrieved.evidenceBatchRevision,
      turnId: 'turn-1',
      proposalId: 'ambiguous-look',
      body: {
        kind: 'complete_looks',
        groups: null,
        alternatives: [
          {
            title: 'Ambiguous piece',
            lines: [
              {
                evidenceRef: sourceEvidence.evidenceRef,
                objectID: sourceEvidence.objectID,
                contentHash: sourceEvidence.contentHash,
                quantity: 1,
                componentSlot: 'piece',
                explanation: 'Catalogue item',
              },
            ],
          },
        ],
      },
    });
    expect(result.status).toBe('staged');
    if (result.status === 'staged' && 'proposal' in result)
      expect(result.proposal.assessment.reasons).toContain(
        `${sourceRecord.objectID}:packaged_contents`,
      );
  });

  it('does not claim completeness when price or type is absent', async () => {
    const sourceRecord = {
      objectID: 'missing-price-or-type',
      Catalog_TitleDescription: 'Unspecified jewellery item',
    };
    const sourceEvidence = { ...evidence, objectID: sourceRecord.objectID, record: sourceRecord };
    const runtime = createConciergeToolRuntime({
      storage: memoryStorage(),
      initialMissionId: 'mission-1',
      getCurrentShopperMessage: () => shopper,
      fetchEvidence: async () => ({
        status: 'ok' as const,
        source: 'prod_catalog' as const,
        missionId: 'mission-1',
        revision: 1,
        expectedRevision: 1,
        turnId: 'turn-1',
        effectiveFilters: [],
        unresolved: [],
        records: [sourceEvidence],
      }),
    });
    await runtime.update(stateInput);
    runtime.beginTurn('turn-1', shopper.id);
    const retrieved = await runtime.retrieve(retrievalInput);
    const result = await runtime.present({
      missionId: 'mission-1',
      expectedStateRevision: 1,
      expectedEvidenceBatchRevision: retrieved.evidenceBatchRevision,
      turnId: 'turn-1',
      proposalId: 'missing-fields',
      body: {
        kind: 'complete_looks',
        groups: null,
        alternatives: [
          {
            title: 'Unknown',
            lines: [
              {
                evidenceRef: sourceEvidence.evidenceRef,
                objectID: sourceEvidence.objectID,
                contentHash: sourceEvidence.contentHash,
                quantity: 1,
                componentSlot: 'piece',
                explanation: 'Catalogue item',
              },
            ],
          },
        ],
      },
    });
    expect(result.status).toBe('staged');
    if (result.status === 'staged' && 'proposal' in result) {
      expect(result.proposal.groups[0].lines[0].unitPriceCents).toBeNull();
      expect(result.proposal.assessment.reasons).toEqual(
        expect.arrayContaining([
          `${sourceRecord.objectID}:price`,
          `${sourceRecord.objectID}:packaged_contents`,
        ]),
      );
    }
  });
});
