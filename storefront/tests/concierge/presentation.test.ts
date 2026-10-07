import { describe, expect, it } from 'vitest';
import schema from '../fixtures/present-choices.schema.json';
import {
  commitStagedChoices,
  presentChoices,
  type PresentationContext,
  type PresentationEvidence,
  type PresentChoicesInput,
} from '../../shared/concierge/presentation';

const baseRecord = (
  objectID: string,
  price: number,
  extra: Record<string, unknown> = {},
): PresentationEvidence => ({
  source: 'prod_catalog',
  objectID,
  contentHash: `hash-${objectID}`,
  retrievedAt: '2026-10-06T00:00:00Z',
  evidenceRef: `ref-${objectID}`,
  missionId: 'm1',
  stateRevision: 2,
  evidenceBatchRevision: 7,
  turnId: 'turn-2',
  record: {
    objectID,
    Pricing_ActivePrice: price,
    Catalog_ProductType: (
      { necklace: 'Necklace', earrings: 'Earrings', ring: 'Ring', bracelet: 'Bracelet' } as Record<
        string,
        string
      >
    )[objectID],
    'Catalog_GemstoneInformation.GemstoneColorGroup': 'Blue',
    ...extra,
  },
});
const evidence = [
  baseRecord('necklace', 189.99),
  baseRecord('earrings', 49.5),
  baseRecord('ring', 20),
  baseRecord('bracelet', 39.99),
];
const context = (patch: Partial<PresentationContext> = {}): PresentationContext => ({
  missionId: 'm1',
  stateRevision: 2,
  evidenceBatchRevision: 7,
  turnId: 'turn-2',
  evidence,
  budgetContextVerified: true,
  ...patch,
});
const line = (objectID: string, componentSlot = 'necklace') => ({
  evidenceRef: `ref-${objectID}`,
  objectID,
  contentHash: `hash-${objectID}`,
  quantity: 1,
  componentSlot,
  explanation: `Useful ${componentSlot}`,
});
const groupBasis = (value = 'Blue') => ({
  attribute: 'Catalog_GemstoneInformation.GemstoneColorGroup' as const,
  value,
});
const groupsInput: PresentChoicesInput = {
  missionId: 'm1',
  expectedStateRevision: 2,
  expectedEvidenceBatchRevision: 7,
  turnId: 'turn-2',
  proposalId: 'p1',
  body: {
    kind: 'product_groups',
    groups: [{ basis: groupBasis(), items: [line('necklace')] }],
    alternatives: null,
  },
};

describe('API-only present_choices staging', () => {
  it('defines required nullable inactive branches for both body kinds', () => {
    const body = schema.properties.body as {
      required: string[];
      properties: Record<string, { anyOf?: unknown[] }>;
    };
    expect(body.required).toEqual(['kind', 'groups', 'alternatives']);
    expect(body.properties.groups.anyOf).toHaveLength(2);
    expect(body.properties.alternatives.anyOf).toHaveLength(2);
  });
  it('rejects flat envelopes and application-owned line fields', () => {
    expect(
      presentChoices(
        {
          ...groupsInput.body,
          missionId: 'm1',
          expectedStateRevision: 2,
          expectedEvidenceBatchRevision: 7,
          turnId: 'turn-2',
          proposalId: 'p1',
        },
        context(),
      ).status,
    ).toBe('invalid_input');
    expect(
      presentChoices(
        {
          ...groupsInput,
          body: {
            ...groupsInput.body,
            groups: [{ basis: groupBasis(), items: [{ ...line('necklace'), owned: true }] }],
          },
        },
        context(),
      ).status,
    ).toBe('invalid_input');
  });
  it('stages selected source-bound lines and exact integer-cent subtotals', () => {
    const result = presentChoices(
      groupsInput,
      context({ bounds: [{ currency: 'USD', basis: 'per-item', operator: 'lte', cents: 20000 }] }),
    );
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(result.proposal.groups[0].lines[0]).toMatchObject({
      evidenceRef: 'ref-necklace',
      unitPriceCents: 18999,
      lineSubtotalCents: 18999,
    });
    expect(result.proposal.combinedItemSubtotalCents).toBeNull();
    expect(result.proposal.assessment.perItem).toBe('accepted');
  });

  it('derives a watch title from an exact 36mm case-size basis', () => {
    const watch = baseRecord('watch-36', 199, {
      Catalog_WatchCaseSize: '36mm',
      Catalog_WatchStyle: 'Dress',
    });
    const result = presentChoices(
      {
        ...groupsInput,
        body: {
          kind: 'product_groups',
          alternatives: null,
          groups: [
            {
              basis: { attribute: 'Catalog_WatchCaseSize', value: '36mm' },
              items: [line('watch-36', 'watch')],
            },
          ],
        },
      },
      context({ evidence: [watch] }),
    );
    expect(result).toMatchObject({
      status: 'staged',
      proposal: { groups: [{ title: 'Watch case size: 36mm' }] },
    });
  });

  it('rejects an unknown watch size and a watch-style basis mismatch', () => {
    const watch = baseRecord('watch-36', 199, {
      Catalog_WatchCaseSize: '36mm',
      Catalog_WatchStyle: 'Dress',
    });
    const unknown = presentChoices(
      {
        ...groupsInput,
        body: {
          kind: 'product_groups',
          alternatives: null,
          groups: [
            {
              basis: { attribute: 'Catalog_WatchCaseSize', value: '41mm' },
              items: [line('watch-36', 'watch')],
            },
          ],
        },
      },
      context({ evidence: [watch] }),
    );
    expect(unknown).toMatchObject({ status: 'invalid_input', reasons: ['group_basis_mismatch'] });
    const mismatch = presentChoices(
      {
        ...groupsInput,
        body: {
          kind: 'product_groups',
          alternatives: null,
          groups: [
            {
              basis: { attribute: 'Catalog_WatchStyle', value: 'Sport' },
              items: [line('watch-36', 'watch')],
            },
          ],
        },
      },
      context({ evidence: [watch] }),
    );
    expect(mismatch).toMatchObject({ status: 'invalid_input', reasons: ['group_basis_mismatch'] });
    expect(mismatch).toMatchObject({
      basisFailure: {
        groupIndex: 0,
        evidenceRef: 'ref-watch-36',
        attribute: 'Catalog_WatchStyle',
        expectedValue: 'Sport',
        observedValues: ['Dress'],
      },
    });
  });

  it('supports a generic jewelry product-type group with an objective title', () => {
    const result = presentChoices(
      {
        ...groupsInput,
        body: {
          kind: 'product_groups',
          alternatives: null,
          groups: [
            {
              basis: { attribute: 'Catalog_ProductType', value: 'Necklace' },
              items: [line('necklace')],
            },
          ],
        },
      },
      context(),
    );
    expect(result).toMatchObject({
      status: 'staged',
      proposal: { groups: [{ title: 'Product type: Necklace' }] },
    });
  });

  it('keeps unknown group arithmetic unresolved across multiple groups', () => {
    const input = {
      ...groupsInput,
      body: {
        kind: 'product_groups' as const,
        alternatives: null,
        groups: [
          {
            basis: groupBasis(),
            items: [line('necklace'), { ...line('earrings', 'earrings'), quantity: 2 }],
          },
          { basis: groupBasis(), items: [line('ring', 'ring')] },
        ],
      },
    };
    const result = presentChoices(
      input,
      context({ evidence: evidence.map((entry) => ({ ...entry, contentsVerified: true })) }),
    );
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(result.proposal.groups[0].itemSubtotalCents).toBeNull();
    expect(result.proposal.combinedItemSubtotalCents).toBeNull();
  });

  it('stages nine distinct products in three catalogue-backed style groups', () => {
    const styles = ['Strand', 'Link', 'Bangle'];
    const nineRecords = styles.flatMap((style, groupIndex) =>
      Array.from({ length: 3 }, (_, itemIndex) => {
        const objectID = `bracelet-${groupIndex}-${itemIndex}`;
        return baseRecord(objectID, 100 + itemIndex, {
          Catalog_ProductType: 'Bracelet',
          Catalog_BraceletType: [style],
          Catalog_TitleDescription: `${style} bracelet variation ${itemIndex + 1}`,
        });
      }),
    );
    const result = presentChoices(
      {
        ...groupsInput,
        body: {
          kind: 'product_groups',
          alternatives: null,
          groups: styles.map((style, groupIndex) => ({
            basis: { attribute: 'Catalog_BraceletType', value: style },
            items: Array.from({ length: 3 }, (_, itemIndex) =>
              line(`bracelet-${groupIndex}-${itemIndex}`, 'bracelet'),
            ),
          })),
        },
      },
      context({ evidence: nineRecords }),
    );
    expect(result).toMatchObject({ status: 'staged' });
    if (result.status !== 'staged') return;
    expect(result.proposal.groups).toHaveLength(3);
    expect(result.proposal.groups.map((group) => group.lines.length)).toEqual([3, 3, 3]);
    expect(
      new Set(result.proposal.groups.flatMap((group) => group.lines.map((item) => item.objectID)))
        .size,
    ).toBe(9);
  });

  it('accepts catalogue-backed bracelet styles and rejects a mismatched variation', () => {
    const braceletEvidence = [
      baseRecord('strand-a', 325, {
        Catalog_ProductType: 'Bracelet',
        Catalog_BraceletType: ['Strand'],
      }),
      baseRecord('strand-b', 340, {
        Catalog_ProductType: 'Bracelet',
        Catalog_BraceletType: ['Strand'],
      }),
      baseRecord('link-a', 313, {
        Catalog_ProductType: 'Bracelet',
        Catalog_BraceletType: ['Link'],
      }),
    ];
    const input = {
      ...groupsInput,
      body: {
        kind: 'product_groups' as const,
        alternatives: null,
        groups: [
          {
            basis: { attribute: 'Catalog_BraceletType' as const, value: 'Strand' },
            items: [line('strand-a'), line('strand-b')],
          },
          {
            basis: { attribute: 'Catalog_BraceletType' as const, value: 'Link' },
            items: [line('link-a')],
          },
        ],
      },
    };
    const result = presentChoices(input, context({ evidence: braceletEvidence }));
    expect(result).toMatchObject({
      status: 'staged',
      proposal: {
        groups: [{ title: 'Bracelet style: Strand' }, { title: 'Bracelet style: Link' }],
      },
    });
    expect(
      presentChoices(
        {
          ...input,
          body: {
            ...input.body,
            groups: [
              {
                basis: { attribute: 'Catalog_BraceletType' as const, value: 'Strand' },
                items: [line('strand-a'), line('link-a')],
              },
            ],
          },
        },
        context({ evidence: braceletEvidence }),
      ),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('supports up to three complete-look alternatives with three purchasable lines', () => {
    const input = {
      ...groupsInput,
      body: {
        kind: 'complete_looks' as const,
        groups: null,
        alternatives: [
          {
            title: 'look one',
            lines: [line('necklace'), line('earrings', 'earrings'), line('ring', 'ring')],
          },
          { title: 'look two', lines: [line('necklace', 'main')] },
        ],
      },
    };
    const result = presentChoices(
      input,
      context({ evidence: evidence.map((entry) => ({ ...entry, contentsVerified: true })) }),
    );
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(result.proposal.combinedItemSubtotalCents).toBeNull();
    expect(result.proposal.groups[0].itemSubtotalCents).toBe(25949);
  });

  it('requires every accepted anchor in each complete-look alternative', () => {
    const input = {
      ...groupsInput,
      body: {
        kind: 'complete_looks' as const,
        groups: null,
        alternatives: [{ title: 'look without anchor', lines: [line('earrings', 'earrings')] }],
      },
    };
    const result = presentChoices(input, context({ acceptedAnchorIds: ['DOQ140'] }));
    expect(result).toMatchObject({
      status: 'invalid_input',
      reasons: ['missing_accepted_anchor'],
      details: [{ kind: 'missing_anchor', alternativeIndex: 0, objectID: 'DOQ140' }],
    });
  });

  it('rejects duplicate component roles within one complete-look alternative', () => {
    const input = {
      ...groupsInput,
      body: {
        kind: 'complete_looks' as const,
        groups: null,
        alternatives: [
          {
            title: 'three bracelets',
            lines: [line('necklace', 'bracelet'), line('earrings', 'bracelet')],
          },
        ],
      },
    };
    const result = presentChoices(input, context());
    expect(result).toMatchObject({
      status: 'invalid_input',
      reasons: ['duplicate_component_slot'],
      details: [
        { kind: 'duplicate_component_slot', alternativeIndex: 0, componentSlot: 'bracelet' },
      ],
    });
  });

  it('returns an exact non-staged total budget conflict for a complete look', () => {
    const input = {
      ...groupsInput,
      body: {
        kind: 'complete_looks' as const,
        groups: null,
        alternatives: [
          {
            title: 'over budget',
            lines: [line('necklace', 'necklace'), line('earrings', 'bracelet')],
          },
        ],
      },
    };
    const result = presentChoices(
      input,
      context({
        evidence: [baseRecord('necklace', 500), baseRecord('earrings', 249.97)].map((entry) => ({
          ...entry,
          contentsVerified: true,
        })),
        bounds: [{ currency: 'USD', basis: 'total', operator: 'lte', cents: 50000 }],
      }),
    );
    expect(result).toMatchObject({
      status: 'budget_conflict',
      reasons: ['budget:total:conflict'],
      details: [
        {
          kind: 'budget_conflict',
          basis: 'total',
          boundCents: 50000,
          subtotalCents: 74997,
        },
      ],
    });
    expect(result.proposal?.groups[0].itemSubtotalCents).toBe(74997);
  });

  it('stages a valid necklace and bracelet look with a shared accepted anchor', () => {
    const input = {
      ...groupsInput,
      body: {
        kind: 'complete_looks' as const,
        groups: null,
        alternatives: [
          {
            title: 'necklace and bracelet',
            lines: [line('necklace', 'necklace'), line('bracelet', 'bracelet')],
          },
          {
            title: 'necklace and earrings',
            lines: [line('necklace', 'necklace'), line('earrings', 'earrings')],
          },
        ],
      },
    };
    const result = presentChoices(
      input,
      context({
        acceptedAnchorIds: ['necklace'],
        evidence: evidence.map((entry) => ({ ...entry, contentsVerified: true })),
      }),
    );
    expect(result.status).toBe('staged');
  });
  it('assesses product groups as independent alternatives for total budgets', () => {
    const input = {
      ...groupsInput,
      body: {
        kind: 'product_groups' as const,
        groups: [
          { basis: groupBasis(), items: [line('necklace', 'ring'), line('earrings', 'ring')] },
        ],
        alternatives: null,
      },
    };
    const result = presentChoices(
      input,
      context({
        evidence: [baseRecord('necklace', 317.89), baseRecord('earrings', 463.89)],
        bounds: [{ currency: 'USD', basis: 'total', operator: 'lte', cents: 50000 }],
      }),
    );
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(result.proposal.combinedItemSubtotalCents).toBeNull();
    expect(result.proposal.assessment.total).toBe('accepted');
    const over = presentChoices(
      input,
      context({
        evidence: [baseRecord('necklace', 317.89), baseRecord('earrings', 563.89)],
        bounds: [{ currency: 'USD', basis: 'total', operator: 'lte', cents: 50000 }],
      }),
    );
    expect(over.status).toBe('staged');
    if (over.status === 'staged') expect(over.proposal.assessment.total).toBe('conflict');
  });

  it.each([
    ['stale state', { expectedStateRevision: 1 }, 'stale_state'],
    ['stale evidence batch', { expectedEvidenceBatchRevision: 6 }, 'stale_evidence'],
    ['stale turn', { turnId: 'turn-old' }, 'stale_evidence'],
  ])('rejects %s while preserving prior proposal', (_name, patch, status) => {
    const prior = presentChoices(groupsInput, context());
    expect(prior.status).toBe('staged');
    if (prior.status !== 'staged') return;
    const result = presentChoices(
      { ...groupsInput, ...patch },
      context({ priorProposal: prior.proposal }),
    );
    expect(result.status).toBe(status);
    expect(result.proposal).toBe(prior.proposal);
  });

  it.each([
    [
      'unknown evidence ref',
      { ...line('necklace'), evidenceRef: 'ref-missing' },
      'invalid_evidence',
    ],
    ['wrong content hash', { ...line('necklace'), contentHash: 'wrong' }, 'invalid_evidence'],
    ['blog/product collision', line('necklace'), 'staged'],
  ])('handles %s', (_name, selected, status) => {
    const input = {
      ...groupsInput,
      body: {
        kind: 'product_groups' as const,
        groups: [{ basis: groupBasis(), items: [selected] }],
        alternatives: null,
      },
    };
    const collision =
      _name === 'blog/product collision'
        ? [...evidence, { ...evidence[0], source: 'blog' as const, evidenceRef: 'blog-ref' }]
        : evidence;
    expect(presentChoices(input, context({ evidence: collision })).status).toBe(status);
  });

  it('rejects duplicate refs, IDs, invalid quantities and invalid roles without staging', () => {
    const duplicate = {
      ...groupsInput,
      body: {
        kind: 'product_groups' as const,
        alternatives: null,
        groups: [{ basis: groupBasis(), items: [line('necklace'), line('necklace', 'ring')] }],
      },
    };
    expect(presentChoices(duplicate, context()).status).toBe('invalid_input');
    const invalidQuantity = {
      ...groupsInput,
      body: {
        kind: 'product_groups' as const,
        alternatives: null,
        groups: [{ basis: groupBasis(), items: [{ ...line('necklace'), quantity: 0 }] }],
      },
    };
    expect(presentChoices(invalidQuantity, context()).status).toBe('invalid_input');
  });

  it('rejects the same product in two discovery groups without blocking a shared look anchor', () => {
    const repeatedDiscovery = {
      ...groupsInput,
      body: {
        kind: 'product_groups' as const,
        alternatives: null,
        groups: [
          { basis: groupBasis(), items: [line('necklace')] },
          { basis: groupBasis(), items: [line('necklace')] },
        ],
      },
    };
    expect(presentChoices(repeatedDiscovery, context())).toMatchObject({
      status: 'invalid_input',
      reasons: ['duplicate_evidence_ref'],
    });
    const sharedAnchor = {
      ...groupsInput,
      body: {
        kind: 'complete_looks' as const,
        groups: null,
        alternatives: [
          {
            title: 'necklace and earrings',
            lines: [line('necklace'), line('earrings', 'earrings')],
          },
          { title: 'necklace and ring', lines: [line('necklace'), line('ring', 'ring')] },
        ],
      },
    };
    expect(presentChoices(sharedAnchor, context())).toMatchObject({ status: 'staged' });
  });

  it('does not count text-identical catalogue offers as separate discovery varieties', () => {
    const sameDescription = {
      Catalog_TitleDescription: 'Blue Dial Stainless Steel Watch',
      Catalog_LongDescription: '39mm blue dial, stainless steel bracelet',
    };
    const input = {
      ...groupsInput,
      body: {
        kind: 'product_groups' as const,
        alternatives: null,
        groups: [{ basis: groupBasis(), items: [line('necklace'), line('earrings')] }],
      },
    };
    const result = presentChoices(
      input,
      context({
        evidence: [
          baseRecord('necklace', 142.99, sameDescription),
          baseRecord('earrings', 137.99, sameDescription),
        ],
      }),
    );
    expect(result).toMatchObject({
      status: 'invalid_input',
      reasons: ['duplicate_catalogue_description'],
    });
  });

  it.each([
    [
      'strict under',
      { currency: 'USD', basis: 'per-item' as const, operator: 'lt' as const, cents: 19000 },
      'accepted',
    ],
    [
      'inclusive ceiling',
      { currency: 'USD', basis: 'per-item' as const, operator: 'lte' as const, cents: 18999 },
      'accepted',
    ],
    [
      'strict conflict',
      { currency: 'USD', basis: 'per-item' as const, operator: 'lt' as const, cents: 18999 },
      'conflict',
    ],
  ])('assesses v3 %s bounds', (_name, bound, expected) => {
    const price = _name === 'strict conflict' ? 190 : 189.99;
    const result = presentChoices(
      groupsInput,
      context({ evidence: [baseRecord('necklace', price)], bounds: [bound] }),
    );
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(result.proposal.assessment.perItem).toBe(expected);
  });

  it('keeps around, contradictory currency, missing price and unresolved owned/package context unresolved', () => {
    const input = {
      ...groupsInput,
      body: {
        kind: 'complete_looks' as const,
        groups: null,
        alternatives: [{ title: 'look', lines: [line('necklace')] }],
      },
    };
    const result = presentChoices(
      input,
      context({
        bounds: [{ currency: 'EUR', basis: 'total', operator: 'around', cents: 20000 }],
        unresolved: [{ objectID: 'necklace', reason: 'packaged_contents' }],
      }),
    );
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(result.proposal.groups[0].lines[0].lineSubtotalCents).toBeNull();
    expect(result.proposal.assessment.total).toBe('unresolved');
    expect(result.proposal.assessment.reasons).toEqual(
      expect.arrayContaining(['necklace:packaged_contents', 'budget:EUR:around']),
    );
  });

  it('commits only when the state and evidence versions still match', () => {
    const staged = presentChoices(groupsInput, context());
    expect(staged.status).toBe('staged');
    if (staged.status !== 'staged') return;
    expect(commitStagedChoices(staged.proposal, { ...context(), turnStatus: 'completed' })).toEqual(
      {
        status: 'committed',
        proposal: staged.proposal,
      },
    );
    expect(commitStagedChoices(staged.proposal, { ...context(), turnStatus: 'aborted' })).toEqual({
      status: 'aborted',
      proposal: null,
    });
    expect(
      commitStagedChoices(staged.proposal, {
        ...context({ stateRevision: 3 }),
        turnStatus: 'completed',
      }),
    ).toEqual({
      status: 'stale_state',
      proposal: null,
    });
  });

  it('rejects stale ledger records and unsafe quantity multiplication', () => {
    expect(
      presentChoices(groupsInput, context({ evidence: [{ ...evidence[0], stateRevision: 1 }] }))
        .status,
    ).toBe('invalid_evidence');
    const unsafe = presentChoices(
      {
        ...groupsInput,
        body: {
          kind: 'product_groups' as const,
          alternatives: null,
          groups: [{ basis: groupBasis(), items: [{ ...line('necklace'), quantity: 20 }] }],
        },
      },
      context({ evidence: [baseRecord('necklace', Number.MAX_SAFE_INTEGER / 100)] }),
    );
    expect(unsafe.status).toBe('staged');
    if (unsafe.status !== 'staged') return;
    expect(unsafe.proposal.groups[0].lines[0].lineSubtotalCents).toBeNull();
    expect(unsafe.proposal.assessment.perItem).toBe('unresolved');
  });

  it('does not claim affordability when budget context is omitted', () => {
    const result = presentChoices(groupsInput, context({ budgetContextVerified: undefined }));
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(result.proposal.assessment.perItem).toBe('unresolved');
    expect(result.proposal.assessment.reasons).toContain('budget:missing_context');
  });

  it('keeps an unresolved other reason unresolved', () => {
    const result = presentChoices(
      groupsInput,
      context({ unresolved: [{ objectID: 'necklace', reason: 'other' }] }),
    );
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(result.proposal.groups[0].lines[0].lineSubtotalCents).toBeNull();
    expect(result.proposal.assessment.perItem).toBe('unresolved');
  });

  it('stages a line whose explanation cites sibling-record facts without altering identity fields', () => {
    // Vienna incident pin (STAGE2-VIENNA-IDENTITY-CAUSAL-EVIDENCE-2026-10-07):
    // the explanation channel is model-authored and intentionally NOT checked
    // against the bound record, so prose carrying a sibling record's price,
    // condition or stock stages successfully while the card's identity fields
    // stay the staged record's own. This test pins that accepted design
    // decision: any future prose-vs-record guard is a deliberate contract
    // change, not a silent behavior shift.
    const blended = {
      ...groupsInput,
      body: {
        kind: 'product_groups' as const,
        groups: [
          {
            basis: groupBasis(),
            items: [
              {
                ...line('necklace'),
                explanation: 'A first quality piece at 49.5 dollars, currently out of stock.',
              },
            ],
          },
        ],
        alternatives: null,
      },
    };
    const result = presentChoices(blended, context());
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    const stagedLine = result.proposal.groups[0].lines[0];
    expect(stagedLine.objectID).toBe('necklace');
    expect(stagedLine.explanation).toContain('first quality');
  });
});
