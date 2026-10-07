import { describe, expect, it } from 'vitest';
import { createBriefState, migrateBriefStateV2ToV3 } from '../../shared/briefState.js';
import {
  canonicalSha256,
  type ShoppingState,
  updateShoppingState,
} from '../../shared/concierge/state/updateShoppingState.js';

const message = {
  id: 'm-current',
  text: 'Please make the budget up to $200 total, and use silver.',
};
const base = (): ShoppingState => ({ brief: createBriefState('mission-1'), receipts: [] });
const add = (operationId = 'op-1') => ({
  missionId: 'mission-1',
  expectedRevision: 0,
  operationId,
  sourceMessageId: message.id,
  operations: [
    {
      action: 'add',
      factIds: [],
      fact: {
        id: 'budget-1',
        field: 'budget',
        value: { kind: 'money', cents: 20000, currency: 'USD', operator: 'lte', basis: 'total' },
        scope: { kind: 'mission', key: null },
        strength: 'requirement',
        certainty: 'explicit',
      },
      sourceQuote: 'up to $200 total',
    },
  ],
});

describe('update_shopping_state domain callback', () => {
  it('applies an exact correction atomically and preserves unrelated facts', async () => {
    const first = await updateShoppingState(base(), add(), message);
    expect(first.result.status).toBe('applied');
    const correction = {
      ...add('op-2'),
      expectedRevision: 1,
      operations: [
        {
          action: 'replace',
          factIds: ['budget-1'],
          fact: {
            id: 'budget-2',
            field: 'budget',
            value: {
              kind: 'money',
              cents: 15000,
              currency: 'USD',
              operator: 'lte',
              basis: 'total',
            },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
          sourceQuote: 'budget up to $150 total',
        },
      ],
    };
    const next = await updateShoppingState(first.state, correction, {
      id: message.id,
      text: 'Actually, budget up to $150 total',
    });
    expect(next.result.status).toBe('applied');
    expect(next.state.brief.facts.find((f) => f.id === 'budget-1')?.status).toBe('superseded');
    expect(next.state.brief.facts.find((f) => f.id === 'budget-2')?.value).toMatchObject({
      kind: 'money',
      cents: 15000,
    });
  });

  it('rejects stale revisions without changing the brief', async () => {
    const current = await updateShoppingState(base(), add(), message);
    const stale = await updateShoppingState(
      current.state,
      { ...add('stale'), expectedRevision: 0 },
      message,
    );
    expect(stale.result.status).toBe('stale_revision');
    expect(stale.state.brief).toEqual(current.state.brief);
  });

  it('replays an exact operation and rejects a conflicting reuse', async () => {
    const first = await updateShoppingState(base(), add(), message);
    const replay = await updateShoppingState(first.state, add(), message);
    expect(replay.result.status).toBe('replayed');
    expect(replay.state.brief.revision).toBe(1);
    const conflict = await updateShoppingState(
      first.state,
      { ...add(), operations: [{ ...add().operations[0], sourceQuote: 'silver' }] },
      message,
    );
    expect(conflict.result.status).toBe('operation_conflict');
  });

  it('rejects forged evidence even when the message ID is current', async () => {
    const forged = {
      ...add(),
      operations: [{ ...add().operations[0], sourceQuote: '$999 total' }],
    };
    const result = await updateShoppingState(base(), forged, message);
    expect(result.result.status).toBe('invalid_input');
    expect(result.result.failure?.code).toBe('quote_mismatch');
  });

  it('retains an ambiguous budget as tentative, without inventing its basis', async () => {
    const input = {
      ...add('ambiguous'),
      operations: [
        {
          ...add().operations[0],
          fact: {
            ...add().operations[0].fact!,
            value: {
              kind: 'money',
              cents: 20000,
              currency: 'USD',
              operator: 'lte',
              basis: 'unresolved',
            },
          },
        },
      ],
    };
    const result = await updateShoppingState(base(), input, message);
    expect(result.result.status).toBe('applied');
    expect(result.state.brief.facts[0]).toMatchObject({
      status: 'tentative',
      value: { kind: 'money', basis: 'unresolved' },
    });
  });

  it('round trips every v3 typed value, component scope, context strength and per-item basis', async () => {
    const input = {
      missionId: 'mission-1',
      expectedRevision: 0,
      operationId: 'typed',
      sourceMessageId: 'typed-message',
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'recipient',
          fact: {
            id: 'recipient',
            field: 'recipient',
            value: { kind: 'text', text: 'sister' },
            scope: { kind: 'recipient', key: 'sister' },
            strength: 'context',
            certainty: 'tentative',
          },
        },
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'size',
          fact: {
            id: 'size',
            field: 'fit',
            value: { kind: 'measurement', value: 7, unit: 'ring_us', component: 'finger' },
            scope: { kind: 'component', key: 'ring' },
            strength: 'preference',
            certainty: 'explicit',
          },
        },
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'saved',
          fact: {
            id: 'saved',
            field: 'selection',
            value: {
              kind: 'product_ref',
              objectID: 'p1',
              sourceIndex: 'prod_catalog',
              relationship: 'saved',
            },
            scope: { kind: 'item', key: 'ring' },
            strength: 'context',
            certainty: 'explicit',
          },
        },
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'all silver',
          fact: {
            id: 'all',
            field: 'material',
            value: {
              kind: 'material_alternatives',
              alternatives: [
                { type: 'Gold', color: 'White', purity: null, plating: null },
                { type: 'Silver', color: null, purity: 'Sterling', plating: null },
              ],
            },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'around $200',
          fact: {
            id: 'around',
            field: 'budget',
            value: {
              kind: 'money',
              cents: 20000,
              currency: 'USD',
              operator: 'around',
              basis: 'per_item',
            },
            scope: { kind: 'mission', key: null },
            strength: 'preference',
            certainty: 'tentative',
          },
        },
      ],
    };
    const result = await updateShoppingState(base(), input, {
      id: 'typed-message',
      text: 'recipient size saved all silver around $200',
    });
    expect(result.result.status).toBe('applied');
    expect(result.state.brief.facts.map((f) => f.field)).toEqual([
      'recipient',
      'fit',
      'selection',
      'material',
      'budget',
    ]);
    expect(result.state.brief.facts.find((f) => f.id === 'size')?.scope.kind).toBe('component');
    expect(result.state.brief.facts.find((f) => f.id === 'around')?.value).toMatchObject({
      kind: 'money',
      operator: 'around',
      basis: 'per-item',
    });
    expect(result.state.brief.events).toHaveLength(1);
  });

  it('uses canonical SHA-256 and preserves v2 undo events during migration', async () => {
    expect(await canonicalSha256({})).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
    const old = {
      ...createBriefState('mission-1'),
      events: [
        {
          revision: 1,
          turnId: 'turn-1',
          beforeFacts: [],
          beforeTombstones: [],
          resetEvidence: { messageId: 'm', quote: 'reset', explicit: true, verified: true },
        },
      ],
    };
    const migrated = migrateBriefStateV2ToV3(old);
    expect(migrated.version).toBe(3);
    expect(migrated.events).toHaveLength(1);
    expect(migrated.events[0].resetEvidence?.quote).toBe('reset');
  });

  it('returns the exact original state object for rejected operations', async () => {
    const original = base();
    const result = await updateShoppingState(
      original,
      { ...add(), operationId: 'bad', sourceMessageId: 'old' },
      message,
    );
    expect(result.result.status).toBe('invalid_input');
    expect(result.state).toBe(original);
  });
  it('rejects duplicate targets atomically', async () => {
    const first = await updateShoppingState(base(), add(), message);
    const result = await updateShoppingState(
      first.state,
      {
        ...add('dup'),
        expectedRevision: 1,
        operations: [
          {
            action: 'retract',
            factIds: ['budget-1', 'budget-1'],
            fact: null,
            sourceQuote: 'up to $200 total',
          },
        ],
      },
      message,
    );
    expect(result.result.status).toBe('invalid_input');
    expect(result.state).toBe(first.state);
    expect(result.state.brief.facts[0].status).toBe('active');
  });
  it('rejects live C1 facet aliases while accepting exact bounded identifiers', async () => {
    const make = (field: string, attribute: string, value: string) => ({
      ...add(`facet-${field}`),
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'facet',
          fact: {
            id: `f-${field}`,
            field,
            value: { kind: 'facet', attribute, values: [value], operator: 'any' },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
      ],
    });
    expect(
      (
        await updateShoppingState(base(), make('material', 'material', 'silver'), {
          id: message.id,
          text: 'facet',
        })
      ).result.failure?.code,
    ).toBe('UNSUPPORTED_FACT_ENCODING');
    expect(
      (
        await updateShoppingState(base(), make('gemstone', 'gemstone color', 'Blue'), {
          id: message.id,
          text: 'facet',
        })
      ).result.failure?.code,
    ).toBe('UNSUPPORTED_FACT_ENCODING');
    expect(
      (
        await updateShoppingState(
          base(),
          make('gemstone', 'Catalog_GemstoneInformation.GemstoneColorGroup', 'Blue'),
          { id: message.id, text: 'facet' },
        )
      ).result.status,
    ).toBe('applied');
  });
  it('keeps watch dial and band facts in their exact catalogue fields', async () => {
    const watchInput = (
      field: string,
      value: unknown,
      sourceQuote: string,
      operationId: string,
    ) => ({
      ...add(operationId),
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote,
          fact: {
            id: operationId,
            field,
            value,
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
      ],
    });
    const dial = await updateShoppingState(
      base(),
      watchInput(
        'watch_dial_color',
        {
          kind: 'facet',
          attribute: 'Catalog_WatchPrimaryDialPrimaryColor',
          values: ['Blue'],
          operator: 'any',
        },
        'blue dial',
        'watch-dial',
      ),
      { id: message.id, text: 'blue dial' },
    );
    expect(dial.result.status).toBe('applied');
    expect(dial.state.brief.facts[0]).toMatchObject({
      field: 'watch_dial_color',
      value: { kind: 'facet', attribute: 'Catalog_WatchPrimaryDialPrimaryColor', values: ['Blue'] },
    });

    const band = await updateShoppingState(
      base(),
      watchInput(
        'watch_band_type',
        {
          kind: 'facet',
          attribute: 'Catalog_WatchBandType',
          values: ['Bracelet'],
          operator: 'any',
        },
        'metal bracelet',
        'watch-band',
      ),
      { id: message.id, text: 'metal bracelet' },
    );
    expect(band.result.status).toBe('applied');
    expect(band.state.brief.facts[0]).toMatchObject({
      field: 'watch_band_type',
      value: { kind: 'facet', attribute: 'Catalog_WatchBandType', values: ['Bracelet'] },
    });

    const material = await updateShoppingState(
      base(),
      watchInput(
        'watch_band_material',
        { kind: 'watch_band_family', family: 'metal' },
        'metal bracelet',
        'watch-metal',
      ),
      { id: message.id, text: 'metal bracelet' },
    );
    expect(material.result.status).toBe('applied');
    expect(material.state.brief.facts[0]).toMatchObject({
      field: 'watch_band_material',
      value: { kind: 'watch_band_family', family: 'metal' },
    });
  });
  it('rejects watch features encoded as gemstone or jewellery material facts', async () => {
    const gemstoneOnWatchField = {
      ...add('watch-as-gemstone'),
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'blue dial',
          fact: {
            id: 'watch-as-gemstone',
            field: 'watch_dial_color',
            value: {
              kind: 'facet',
              attribute: 'Catalog_GemstoneInformation.GemstoneColorGroup',
              values: ['Blue'],
              operator: 'any',
            },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
      ],
    };
    expect(
      (
        await updateShoppingState(base(), gemstoneOnWatchField, {
          id: message.id,
          text: 'blue dial',
        })
      ).result.failure?.code,
    ).toBe('UNSUPPORTED_FACT_ENCODING');
    const invalidMaterial = {
      ...add('watch-material-facet'),
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'metal bracelet',
          fact: {
            id: 'watch-material-facet',
            field: 'watch_band_material',
            value: {
              kind: 'facet',
              attribute: 'Catalog_JewelryMaterialNavigationName',
              values: ['Steel'],
              operator: 'any',
            },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
      ],
    };
    expect(
      (
        await updateShoppingState(base(), invalidMaterial, {
          id: message.id,
          text: 'metal bracelet',
        })
      ).result.failure?.code,
    ).toBe('UNSUPPORTED_FACT_ENCODING');
  });
  it('rejects product type text and accepts exact bounded catalogue types', async () => {
    const text = {
      ...add('text-type'),
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'facet',
          fact: {
            id: 'text-type',
            field: 'product_type',
            value: { kind: 'text', text: 'necklace' },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
      ],
    };
    expect(
      (await updateShoppingState(base(), text, { id: message.id, text: 'facet' })).result.failure
        ?.code,
    ).toBe('UNSUPPORTED_FACT_ENCODING');
    for (const value of ['Necklace', 'Earrings', 'Bracelet', 'Ring', 'Pendant', 'Wrist Watch']) {
      const input = {
        ...add(`type-${value}`),
        operations: [
          {
            action: 'add',
            factIds: [],
            sourceQuote: 'facet',
            fact: {
              id: `type-${value}`,
              field: 'product_type',
              value: {
                kind: 'facet',
                attribute: 'Catalog_ProductType',
                values: [value],
                operator: 'any',
              },
              scope: { kind: 'mission', key: null },
              strength: 'requirement',
              certainty: 'explicit',
            },
          },
        ],
      };
      expect(
        (await updateShoppingState(base(), input, { id: message.id, text: 'facet' })).result.status,
      ).toBe('applied');
    }
    const orInput = {
      ...add('type-or'),
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'facet',
          fact: {
            id: 'or',
            field: 'product_type',
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Necklace', 'Earrings'],
              operator: 'any',
            },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
      ],
    };
    expect(
      (await updateShoppingState(base(), orInput, { id: message.id, text: 'facet' })).result.status,
    ).toBe('applied');
  });
  it('accepts exact no-ring and no-heart exclusions and rejects hard text exclusions', async () => {
    const make = (id: string, attribute: string, values: string[]) => ({
      ...add(id),
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'exclude',
          fact: {
            id,
            field: 'exclusion',
            value: { kind: 'facet', attribute, values, operator: 'none' },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
      ],
    });
    const ring = await updateShoppingState(
      base(),
      make('no-ring', 'Catalog_ProductType', ['Ring']),
      { id: message.id, text: 'exclude' },
    );
    expect(ring.result.status).toBe('applied');
    const heart = await updateShoppingState(
      ring.state,
      { ...make('no-heart', 'Catalog_Motif', ['Heart']), expectedRevision: 1 },
      { id: message.id, text: 'exclude' },
    );
    expect(heart.result.status).toBe('applied');
    expect(heart.state.brief.facts).toHaveLength(2);
    const text = {
      ...add('text-exclusion'),
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'exclude',
          fact: {
            id: 'text-exclusion',
            field: 'exclusion',
            value: { kind: 'text', text: 'Skip rings' },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
      ],
    };
    expect(
      (await updateShoppingState(base(), text, { id: message.id, text: 'exclude' })).result.failure
        ?.code,
    ).toBe('UNSUPPORTED_FACT_ENCODING');
  });
  it('accepts a material-colour exclusion facet and rejects unsupported colour values', async () => {
    const make = (id: string, values: string[], operator: 'none' | 'any' = 'none') => ({
      missionId: 'mission-1',
      expectedRevision: 0,
      operationId: id,
      sourceMessageId: message.id,
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'exclude colour',
          fact: {
            id,
            field: 'exclusion',
            value: {
              kind: 'facet',
              attribute: 'Catalog_MaterialInformation.MaterialColor',
              values,
              operator,
            },
            scope: { kind: 'mission', key: null },
            strength: 'requirement',
            certainty: 'explicit',
          },
        },
      ],
    });
    const applied = await updateShoppingState(base(), make('no-yellow', ['Yellow']), {
      id: message.id,
      text: 'exclude colour',
    });
    expect(applied.result.status).toBe('applied');
    const twoTone = await updateShoppingState(
      applied.state,
      { ...make('no-two-tone', ['Two-tone']), expectedRevision: 1 },
      { id: message.id, text: 'exclude colour' },
    );
    expect(twoTone.result.status).toBe('applied');
    const unknownColour = await updateShoppingState(base(), make('no-chartreuse', ['Chartreuse']), {
      id: message.id,
      text: 'exclude colour',
    });
    expect(unknownColour.result.failure?.code).toBe('UNSUPPORTED_FACT_ENCODING');
    const wrongOperator = await updateShoppingState(base(), make('yellow-any', ['Yellow'], 'any'), {
      id: message.id,
      text: 'exclude colour',
    });
    expect(wrongOperator.result.failure?.code).toBe('UNSUPPORTED_FACT_ENCODING');
  });
  it('accepts an empty structural operation list but returns a retryable no-op failure', async () => {
    const empty = {
      missionId: 'mission-1',
      expectedRevision: 0,
      operationId: 'retry-me',
      sourceMessageId: message.id,
      operations: [],
    };
    const original = base();
    const first = await updateShoppingState(original, empty, message);
    expect(first.result.failure?.code).toBe('NO_OPERATIONS');
    expect(first.state).toBe(original);
    expect(first.state.receipts).toHaveLength(0);
    const corrected = await updateShoppingState(first.state, { ...add('retry-me') }, message);
    expect(corrected.result.status).toBe('applied');
  });
  it('enforces strict action and scope shapes before mutation', async () => {
    const malformed = [
      { ...add('bad-add'), operations: [{ ...add().operations[0], factIds: ['unexpected'] }] },
      {
        ...add('bad-retract'),
        operations: [
          { action: 'retract', factIds: [], fact: null, sourceQuote: 'up to $200 total' },
        ],
      },
      {
        ...add('bad-scope'),
        operations: [
          {
            ...add().operations[0],
            fact: { ...add().operations[0].fact!, scope: { kind: 'mission', key: 'wrong' } },
          },
        ],
      },
    ];
    for (const input of malformed) {
      const result = await updateShoppingState(base(), input, message);
      expect(result.result.status).toBe('invalid_input');
      expect(result.state.brief.revision).toBe(0);
    }
  });
  it('preserves an exact material alternatives union and strength', async () => {
    const input = {
      missionId: 'mission-1',
      expectedRevision: 0,
      operationId: 'materials',
      sourceMessageId: 'materials',
      operations: [
        {
          action: 'add',
          factIds: [],
          sourceQuote: 'silver or white gold',
          fact: {
            id: 'materials',
            field: 'material',
            value: {
              kind: 'material_alternatives',
              alternatives: [
                {
                  type: 'Silver',
                  color: null,
                  purity: 'Sterling',
                  plating: { presence: 'forbidden', purity: null },
                },
                { type: 'Gold', color: 'White', purity: null, plating: null },
              ],
            },
            scope: { kind: 'mission', key: null },
            strength: 'preference',
            certainty: 'explicit',
          },
        },
      ],
    };
    const result = await updateShoppingState(base(), input, {
      id: 'materials',
      text: 'silver or white gold',
    });
    expect(result.result.status).toBe('applied');
    expect(result.state.brief.facts[0].value).toMatchObject({ kind: 'material_alternatives' });
    expect(result.state.brief.facts[0].strength).toBe('preference');
  });
  it('rejects empty, duplicate, and invalid forbidden-plating alternatives', async () => {
    const cases = [
      [{ type: null, color: null, purity: null, plating: null }],
      [
        { type: 'Silver', color: null, purity: null, plating: null },
        { type: 'Silver', color: null, purity: null, plating: null },
      ],
      [
        {
          type: 'Silver',
          color: null,
          purity: null,
          plating: { presence: 'forbidden', purity: '925' },
        },
      ],
    ];
    for (const alternatives of cases) {
      const input = {
        missionId: 'mission-1',
        expectedRevision: 0,
        operationId: crypto.randomUUID(),
        sourceMessageId: 'm',
        operations: [
          {
            action: 'add',
            factIds: [],
            sourceQuote: 'materials',
            fact: {
              id: crypto.randomUUID(),
              field: 'material',
              value: { kind: 'material_alternatives', alternatives },
              scope: { kind: 'mission', key: null },
              strength: 'requirement',
              certainty: 'explicit',
            },
          },
        ],
      };
      const result = await updateShoppingState(base(), input, { id: 'm', text: 'materials' });
      expect(result.result.status).toBe('invalid_input');
    }
  });
});
