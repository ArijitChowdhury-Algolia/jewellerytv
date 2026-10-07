import { describe, expect, it, vi } from 'vitest';
import { briefStateV3Schema, type BriefStateV3 } from '../../shared/briefSchema.js';
import {
  createAlgoliaEvidenceSearch,
  createEvidenceRetriever,
  evidenceRef,
  hashEvidenceRecord,
} from '../../server/concierge/retrieveEvidence.js';

const ev = { messageId: 'm', quote: 'explicit', explicit: true, verified: true };
const state = (facts: unknown[] = [], revision = 2): BriefStateV3 =>
  briefStateV3Schema.parse({
    version: 3,
    missionId: 'mission-1',
    revision,
    facts: facts.map((fact, i) => ({
      id: `f${i}`,
      status: 'active',
      revision,
      createdAt: 'now',
      origin: 'spoken',
      certainty: 'explicit',
      strength: 'requirement',
      evidence: ev,
      ...(fact as Record<string, unknown>),
    })),
    processedTurns: [],
    tombstones: [],
    events: [],
  });
const productInput = (patch: Record<string, unknown> = {}) => ({
  source: 'prod_catalog',
  query: '',
  count: 3,
  missionId: 'mission-1',
  expectedRevision: 2,
  turnId: 'turn-1',
  target: { kind: 'item', itemKey: 'Ring', productType: 'Ring' },
  ...patch,
});
const ring = {
  field: 'product_type',
  scope: { kind: 'mission', key: null },
  value: { kind: 'facet', attribute: 'Catalog_ProductType', values: ['Ring'], operator: 'any' },
};

describe('retrieve_evidence', () => {
  it('rejects model supplied constraints and arbitrary sources', async () => {
    const retrieve = createEvidenceRetriever({
      search: vi.fn().mockResolvedValue([]),
      currentState: async () => state([ring]),
    });
    expect((await retrieve({ ...productInput(), source: 'other' })).status).toBe('invalid_input');
    expect(
      (await retrieve({ ...productInput(), filters: 'Pricing_ActivePrice < 10' })).status,
    ).toBe('invalid_input');
  });
  it('requires explicit nullable target by source', async () => {
    const retrieve = createEvidenceRetriever({
      search: vi.fn().mockResolvedValue([]),
      currentState: async () => state([ring]),
    });
    const blog = {
      source: 'blog',
      target: null,
      query: '',
      count: 1,
      missionId: 'mission-1',
      expectedRevision: 2,
      turnId: 'turn-1',
    };
    expect((await retrieve(blog)).status).toBe('zero_hits');
    expect(
      (await retrieve({ ...blog, target: { kind: 'item', itemKey: 'Ring', productType: 'Ring' } }))
        .status,
    ).toBe('invalid_input');
    expect((await retrieve({ ...productInput(), target: null })).status).toBe('zero_hits');
    expect((await retrieve({ ...blog, extra: true })).status).toBe('invalid_input');
    expect(
      (
        await retrieve({
          source: 'blog',
          target: null,
          query: '',
          count: 0,
          missionId: 'm',
          expectedRevision: 0,
          turnId: 't',
        })
      ).status,
    ).toBe('invalid_input');
  });
  it('applies the confirmed gemstone blue facet exactly', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          ring,
          {
            field: 'gemstone',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'facet',
              attribute: 'Catalog_GemstoneInformation.GemstoneColorGroup',
              values: ['Blue'],
              operator: 'any',
            },
          },
        ]),
    });
    await retrieve(productInput({ target: null }));
    expect(search.mock.calls[0][0].filters).toEqual([
      { field: 'Catalog_ProductType', operator: 'eq', value: 'Ring' },
      { field: 'Catalog_GemstoneInformation.GemstoneColorGroup', operator: 'eq', value: 'Blue' },
    ]);
  });
  it('keeps blue watch dials and metal bracelet requirements on watch attributes', async () => {
    const search = vi.fn().mockResolvedValue([
      {
        objectID: 'watch-bad-band',
        Catalog_ProductType: 'Wrist Watch',
        Catalog_WatchPrimaryDialPrimaryColor: 'Blue',
        Catalog_WatchBandType: 'Bracelet',
        Catalog_BandMaterialInformation: [{ WatchBandMaterialName: 'Silicone' }],
        Pricing_ActivePrice: 79,
      },
      {
        objectID: 'watch-1',
        Catalog_ProductType: 'Wrist Watch',
        Catalog_WatchPrimaryDialPrimaryColor: 'Blue',
        Catalog_WatchBandType: 'Bracelet',
        Catalog_BandMaterialInformation: [{ WatchBandMaterialName: 'Stainless Steel' }],
        Catalog_WatchCaseSize: '27mm',
        Pricing_ActivePrice: 99,
      },
    ]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          {
            field: 'product_type',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Wrist Watch'],
              operator: 'any',
            },
          },
          {
            field: 'watch_dial_color',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'facet',
              attribute: 'Catalog_WatchPrimaryDialPrimaryColor',
              values: ['Blue'],
              operator: 'any',
            },
          },
          {
            field: 'watch_band_type',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'facet',
              attribute: 'Catalog_WatchBandType',
              values: ['Bracelet'],
              operator: 'any',
            },
          },
          {
            field: 'watch_band_material',
            scope: { kind: 'mission', key: null },
            value: { kind: 'watch_band_family', family: 'metal' },
          },
        ]),
    });
    const result = await retrieve(productInput({ target: null, query: 'blue dial watch' }));
    expect(result.status).toBe('ok');
    expect(result.records.map((record) => record.objectID)).toEqual(['watch-1']);
    expect(search.mock.calls[0][0].filters).toEqual(
      expect.arrayContaining([
        { field: 'Catalog_ProductType', operator: 'eq', value: 'Wrist Watch' },
        { field: 'Catalog_WatchPrimaryDialPrimaryColor', operator: 'eq', value: 'Blue' },
        { field: 'Catalog_WatchBandType', operator: 'eq', value: 'Bracelet' },
        expect.objectContaining({
          field: 'Catalog_BandMaterialInformation.WatchBandMaterialName',
          operator: 'in',
          value: expect.arrayContaining(['Stainless Steel', 'Titanium']),
        }),
      ]),
    );
    expect(result.records[0].record).toMatchObject({
      Catalog_WatchPrimaryDialPrimaryColor: 'Blue',
      Catalog_WatchBandType: 'Bracelet',
      Catalog_WatchCaseSize: '27mm',
      Catalog_BandMaterialInformation: [{ WatchBandMaterialName: 'Stainless Steel' }],
    });
  });
  it('serializes watch material family as a facet OR without changing index settings', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [{ hits: [] }] }), { status: 200 }),
      );
    await createAlgoliaEvidenceSearch({ appId: 'app', searchOnlyApiKey: 'key', fetch })({
      source: 'prod_catalog',
      query: 'blue dial watch',
      count: 5,
      filters: [
        { field: 'Catalog_WatchPrimaryDialPrimaryColor', operator: 'eq', value: 'Blue' },
        {
          field: 'Catalog_BandMaterialInformation.WatchBandMaterialName',
          operator: 'in',
          value: ['Stainless Steel', 'Titanium'],
        },
      ],
      signal: new AbortController().signal,
    });
    const params = new URLSearchParams(JSON.parse(fetch.mock.calls[0][1].body).requests[0].params);
    expect(JSON.parse(params.get('facetFilters')!)).toEqual([
      'Catalog_WatchPrimaryDialPrimaryColor:Blue',
      [
        'Catalog_BandMaterialInformation.WatchBandMaterialName:Stainless Steel',
        'Catalog_BandMaterialInformation.WatchBandMaterialName:Titanium',
      ],
    ]);
  });
  it('keeps occasion and recipient context out of broad product filters', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          {
            field: 'occasion',
            scope: { kind: 'mission', key: null },
            value: { kind: 'text', text: 'tenth anniversary' },
          },
          {
            field: 'recipient',
            scope: { kind: 'mission', key: null },
            value: { kind: 'text', text: 'partner' },
          },
          {
            field: 'budget',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'money',
              cents: 50000,
              currency: 'USD',
              operator: 'lte',
              basis: 'per-item',
            },
          },
        ]),
    });
    const result = await retrieve(productInput({ target: null }));
    expect(result.status).toBe('zero_hits');
    expect(search.mock.calls[0][0].filters).toEqual([
      { field: 'Pricing_ActivePrice', operator: 'lte', value: 500 },
    ]);
  });
  it('keeps subjective design context out of broad product filters', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          {
            field: 'design',
            scope: { kind: 'mission', key: null },
            value: { kind: 'text', text: 'subtle, not showy' },
          },
          {
            field: 'budget',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'money',
              cents: 50000,
              currency: 'USD',
              operator: 'lte',
              basis: 'per-item',
            },
          },
        ]),
    });
    const result = await retrieve(productInput({ target: null }));
    expect(result.status).toBe('zero_hits');
    expect(result.unresolved).toEqual([]);
    expect(search.mock.calls[0][0].filters).toEqual([
      { field: 'Pricing_ActivePrice', operator: 'lte', value: 500 },
    ]);
  });
  it('accepts canonical targeted types, rejects aliases, and gates broad OR types', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          {
            field: 'product_type',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Necklace', 'Earrings'],
              operator: 'any',
            },
          },
          {
            field: 'product_type',
            scope: { kind: 'item', key: 'necklace' },
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Necklace'],
              operator: 'any',
            },
          },
        ]),
    });
    expect(
      (
        await retrieve(
          productInput({ target: { kind: 'item', itemKey: 'necklace', productType: 'Necklace' } }),
        )
      ).status,
    ).toBe('zero_hits');
    expect(search.mock.calls.at(-1)?.[0].filters).toEqual([
      { field: 'Catalog_ProductType', operator: 'eq', value: 'Necklace' },
    ]);
    expect(
      (
        await retrieve({
          ...productInput(),
          target: { kind: 'item', itemKey: 'necklace', productType: 'necklace' },
        })
      ).status,
    ).toBe('invalid_input');
    expect((await retrieve(productInput({ target: null }))).status).toBe('unsupported_constraint');
  });
  it('applies one accepted mission product type in a broad product search', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          {
            field: 'product_type',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Necklace'],
              operator: 'any',
            },
          },
        ]),
    });
    expect((await retrieve(productInput({ target: null }))).status).toBe('zero_hits');
    expect(search.mock.calls[0][0].filters).toContainEqual({
      field: 'Catalog_ProductType',
      operator: 'eq',
      value: 'Necklace',
    });
  });
  it('binds distinct item identities and keeps scoped filters isolated', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          {
            field: 'product_type',
            scope: { kind: 'item', key: 'gift-necklace' },
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Necklace'],
              operator: 'any',
            },
          },
          {
            field: 'gemstone',
            scope: { kind: 'item', key: 'gift-necklace' },
            value: {
              kind: 'facet',
              attribute: 'Catalog_GemstoneInformation.GemstoneColorGroup',
              values: ['Blue'],
              operator: 'any',
            },
          },
          {
            field: 'product_type',
            scope: { kind: 'item', key: 'companion-earrings' },
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Earrings'],
              operator: 'any',
            },
          },
          {
            field: 'exclusion',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Ring'],
              operator: 'none',
            },
          },
          {
            field: 'exclusion',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'facet',
              attribute: 'Catalog_Motif',
              values: ['Heart'],
              operator: 'none',
            },
          },
        ]),
    });
    expect(
      (
        await retrieve(
          productInput({
            target: { kind: 'item', itemKey: 'gift-necklace', productType: 'Necklace' },
          }),
        )
      ).status,
    ).toBe('zero_hits');
    expect(search.mock.calls[0][0].filters).toEqual([
      { field: 'Catalog_ProductType', operator: 'eq', value: 'Necklace' },
      { field: 'Catalog_GemstoneInformation.GemstoneColorGroup', operator: 'eq', value: 'Blue' },
      { field: 'Catalog_ProductType', operator: 'neq', value: 'Ring' },
      { field: 'Catalog_Motif', operator: 'neq', value: 'Heart' },
    ]);
    expect(
      (
        await retrieve(
          productInput({ target: { kind: 'item', itemKey: 'wrong-key', productType: 'Necklace' } }),
        )
      ).error?.code,
    ).toBe('TARGET_MISMATCH');
    expect(
      (
        await retrieve(
          productInput({
            target: { kind: 'item', itemKey: 'gift-necklace', productType: 'Earrings' },
          }),
        )
      ).error?.code,
    ).toBe('TARGET_MISMATCH');
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('serializes numeric bounds with Algolia symbols and rejects neq', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [{ hits: [] }] }), { status: 200 }),
      );
    const adapter = createAlgoliaEvidenceSearch({ appId: 'app', searchOnlyApiKey: 'key', fetch });
    await adapter({
      source: 'prod_catalog',
      query: '',
      count: 1,
      filters: [
        { field: 'Pricing_ActivePrice', operator: 'lt', value: 10 },
        { field: 'Pricing_ActivePrice', operator: 'lte', value: 20 },
        { field: 'Pricing_ActivePrice', operator: 'gt', value: 30 },
        { field: 'Pricing_ActivePrice', operator: 'gte', value: 40 },
        { field: 'Pricing_ActivePrice', operator: 'eq', value: 50 },
      ],
      signal: new AbortController().signal,
    });
    const params = new URLSearchParams(JSON.parse(fetch.mock.calls[0][1].body).requests[0].params);
    expect(JSON.parse(params.get('numericFilters')!)).toEqual([
      'Pricing_ActivePrice<10',
      'Pricing_ActivePrice<=20',
      'Pricing_ActivePrice>30',
      'Pricing_ActivePrice>=40',
      'Pricing_ActivePrice=50',
    ]);
    expect(params.get('numericFilters')).not.toContain('lt');
    await expect(
      adapter({
        source: 'prod_catalog',
        query: '',
        count: 1,
        filters: [{ field: 'Pricing_ActivePrice', operator: 'neq', value: 10 }],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/Unsupported numeric operator/);
  });
  it('reports sanitized upstream HTTP status without query or credential leakage', async () => {
    for (const status of [400, 429]) {
      const fetch = vi.fn().mockResolvedValue(new Response('secret-query-and-key', { status }));
      const retrieve = createEvidenceRetriever({
        search: createAlgoliaEvidenceSearch({ appId: 'app', searchOnlyApiKey: 'key', fetch }),
        currentState: async () => state([ring]),
      });
      const result = await retrieve(productInput({ query: 'private shopper query' }));
      expect(result.status).toBe('upstream_failure');
      expect(result.error).toMatchObject({
        code: `UPSTREAM_HTTP_${status}`,
        upstreamStatus: status,
      });
      expect(JSON.stringify(result)).not.toContain('private shopper query');
      expect(JSON.stringify(result)).not.toContain('key');
      expect(JSON.stringify(result)).not.toContain('secret-query');
    }
  });
  it('retrieves exact product IDs in requested order and keeps accepted constraints', async () => {
    const search = vi.fn().mockResolvedValue([
      { objectID: 'DOQ140', Catalog_ProductType: 'Ring', Pricing_ActivePrice: 120 },
      { objectID: 'RST2197', Catalog_ProductType: 'Ring', Pricing_ActivePrice: 130 },
    ]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () => state([ring]),
    });
    const result = await retrieve(
      productInput({ query: '', exactObjectIDs: ['DOQ140', 'RST2197'] }),
    );
    expect(result.status).toBe('ok');
    expect(result.records.map((record) => record.objectID)).toEqual(['DOQ140', 'RST2197']);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        exactObjectIDs: ['DOQ140', 'RST2197'],
        count: 2,
        filters: [{ field: 'Catalog_ProductType', operator: 'eq', value: 'Ring' }],
      }),
    );
  });
  it('treats an accepted product reference as selection state, not a search constraint', async () => {
    const search = vi
      .fn()
      .mockResolvedValue([
        { objectID: 'DOQ140', Catalog_ProductType: 'Necklace', Pricing_ActivePrice: 179.99 },
      ]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          {
            field: 'product_type',
            scope: { kind: 'item', key: 'DOQ140' },
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Necklace'],
              operator: 'any',
            },
          },
          {
            field: 'item_reference',
            scope: { kind: 'item', key: 'DOQ140' },
            value: {
              kind: 'product_ref',
              objectID: 'DOQ140',
              sourceIndex: 'prod_catalog',
              relationship: 'accepted',
            },
          },
        ]),
    });
    const result = await retrieve(
      productInput({
        target: { kind: 'item', itemKey: 'DOQ140', productType: 'Necklace' },
        exactObjectIDs: ['DOQ140'],
      }),
    );
    expect(result.status).toBe('ok');
    expect(result.records.map((record) => record.objectID)).toEqual(['DOQ140']);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ field: 'Catalog_ProductType', operator: 'eq', value: 'Necklace' }],
      }),
    );
  });
  it('rejects a wrong returned ID and reports missing exact IDs as zero hits', async () => {
    const retrieve = createEvidenceRetriever({
      search: vi.fn().mockResolvedValue([{ objectID: 'other', Catalog_ProductType: 'Ring' }]),
      currentState: async () => state([ring]),
    });
    const wrong = await retrieve(productInput({ exactObjectIDs: ['RST2197'] }));
    expect(wrong.status).toBe('zero_hits');
    expect(wrong.records).toEqual([]);
    const missing = await createEvidenceRetriever({
      search: vi.fn().mockResolvedValue([]),
      currentState: async () => state([ring]),
    })(productInput({ exactObjectIDs: ['DOQ140'] }));
    expect(missing.status).toBe('zero_hits');
  });
  it('rejects malformed exact IDs, blog exact IDs, and more than three IDs', async () => {
    const retrieve = createEvidenceRetriever({
      search: vi.fn().mockResolvedValue([]),
      currentState: async () => state([ring]),
    });
    expect((await retrieve(productInput({ exactObjectIDs: ['../DOQ140'] }))).status).toBe(
      'invalid_input',
    );
    expect((await retrieve(productInput({ exactObjectIDs: ['bad id'] }))).status).toBe(
      'invalid_input',
    );
    expect((await retrieve(productInput({ exactObjectIDs: ['A', 'B', 'C', 'D'] }))).status).toBe(
      'invalid_input',
    );
    expect(
      (
        await retrieve({
          source: 'blog',
          query: '',
          count: 1,
          exactObjectIDs: ['DOQ140'],
          missionId: 'mission-1',
          expectedRevision: 2,
          turnId: 'turn-1',
          target: null,
        })
      ).status,
    ).toBe('invalid_input');
  });
  it('uses read-only GET exact lookup with source isolation and never mutation methods', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string, _init: RequestInit) => {
      expect(url).toContain('/1/indexes/prod_catalog/DOQ140');
      return new Response(JSON.stringify({ objectID: 'DOQ140', Catalog_ProductType: 'Ring' }), {
        status: 200,
      });
    });
    const adapter = createAlgoliaEvidenceSearch({ appId: 'app', searchOnlyApiKey: 'key', fetch });
    const records = await adapter({
      source: 'prod_catalog',
      query: '',
      count: 1,
      exactObjectIDs: ['DOQ140'],
      filters: [],
      signal: new AbortController().signal,
    });
    expect(records).toEqual([{ objectID: 'DOQ140', Catalog_ProductType: 'Ring' }]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/1/indexes/prod_catalog/DOQ140'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch.mock.calls[0][1].method).not.toBe('POST');
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
  });
  it('compiles accepted strict USD price and product type into effective filters', async () => {
    const search = vi
      .fn()
      .mockResolvedValue([{ objectID: 'p1', Pricing_ActivePrice: 99.99, secret: 'omit' }]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          ring,
          {
            field: 'budget',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'money',
              cents: 10000,
              currency: 'USD',
              operator: 'lt',
              basis: 'per-item',
            },
          },
        ]),
    });
    const response = await retrieve(productInput());
    expect(response.status).toBe('ok');
    expect(response.effectiveFilters).toEqual([
      { field: 'Catalog_ProductType', operator: 'eq', value: 'Ring' },
      { field: 'Pricing_ActivePrice', operator: 'lt', value: 100 },
    ]);
    expect(response.records[0].record).not.toHaveProperty('secret');
  });
  it('keeps product and blog records separate when objectIDs collide', async () => {
    const retrieve = createEvidenceRetriever({
      search: async ({ source }) =>
        source === 'blog'
          ? [
              {
                objectID: 'same',
                article_id: 'article-1',
                title: 'T',
                heading_path: 'H',
                content: 'Useful passage',
                canonical_url: 'https://example.com/a',
                source_role: 'education',
                content_hash: 'hash',
              },
            ]
          : [{ objectID: 'same', title: source }],
      currentState: async () => state([ring]),
    });
    const product = await retrieve(productInput());
    const blog = await retrieve({
      source: 'blog',
      target: null,
      query: '',
      count: 3,
      missionId: 'mission-1',
      expectedRevision: 2,
      turnId: 'turn-1',
    });
    expect(product.records[0].evidenceRef).not.toBe(blog.records[0].evidenceRef);
    expect(product.records[0].source).toBe('prod_catalog');
    expect(blog.records[0].source).toBe('blog');
  });
  it('keeps blog chunks with the same article separate and rejects incomplete passages', async () => {
    const chunks = [
      {
        objectID: 'chunk-1',
        article_id: 'article-1',
        title: 'T',
        heading_path: 'H1',
        content: 'Passage one',
        canonical_url: 'https://example.com/a',
        source_role: 'education',
        content_hash: 'h1',
      },
      {
        objectID: 'chunk-2',
        article_id: 'article-1',
        title: 'T',
        heading_path: 'H2',
        content: 'Passage two',
        canonical_url: 'https://example.com/a',
        source_role: 'education',
        content_hash: 'h2',
      },
    ];
    const retrieve = createEvidenceRetriever({
      search: async () => chunks,
      currentState: async () => state([ring]),
    });
    const response = await retrieve({
      source: 'blog',
      target: null,
      query: '',
      count: 3,
      missionId: 'mission-1',
      expectedRevision: 2,
      turnId: 'turn-1',
    });
    expect(response.status).toBe('ok');
    expect(response.records.map((record) => record.objectID)).toEqual(['chunk-1', 'chunk-2']);
    expect(new Set(response.records.map((record) => record.record.article_id)).size).toBe(1);
    const incomplete = createEvidenceRetriever({
      search: async () => [
        { objectID: 'bad', article_id: 'article-1', content: 'missing canonical fields' },
      ],
      currentState: async () => state([ring]),
    });
    expect(
      (
        await incomplete({
          source: 'blog',
          target: null,
          query: '',
          count: 1,
          missionId: 'mission-1',
          expectedRevision: 2,
          turnId: 'turn-1',
        })
      ).status,
    ).toBe('incomplete_evidence');
  });
  it('returns unresolved material and around constraints without searching', async () => {
    const search = vi.fn();
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          ring,
          {
            field: 'material',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'facet',
              attribute: 'Catalog_Material',
              values: ['White Gold'],
              operator: 'any',
            },
          },
          {
            field: 'budget',
            scope: { kind: 'mission', key: null },
            value: {
              kind: 'money',
              cents: 10000,
              currency: 'USD',
              operator: 'around',
              basis: 'per-item',
            },
          },
        ]),
    });
    const response = await retrieve(productInput());
    expect(response.status).toBe('unsupported_constraint');
    expect(response.unresolved.length).toBe(2);
    expect(search).not.toHaveBeenCalled();
  });
  it('distinguishes stale revision before and after search', async () => {
    expect(
      (
        await createEvidenceRetriever({
          search: vi.fn(),
          currentState: async () => state([ring], 3),
        })(productInput())
      ).status,
    ).toBe('stale_revision');
    let calls = 0;
    const response = await createEvidenceRetriever({
      search: async () => [{ objectID: 'p' }],
      currentState: async () => state([ring], ++calls === 1 ? 2 : 3),
    })(productInput());
    expect(response.status).toBe('stale_revision');
  });
  it('distinguishes zero hits, upstream failure, and timeout', async () => {
    const base = { currentState: async () => state([ring]) };
    expect(
      (await createEvidenceRetriever({ ...base, search: async () => [] })(productInput())).status,
    ).toBe('zero_hits');
    expect(
      (
        await createEvidenceRetriever({
          ...base,
          search: async () => {
            throw new Error('failed');
          },
        })(productInput())
      ).status,
    ).toBe('upstream_failure');
    expect(
      (
        await createEvidenceRetriever({
          ...base,
          timeoutMs: 1,
          search: async ({ signal }) => {
            await new Promise((_, reject) =>
              signal.addEventListener('abort', () => reject(new Error('abort'))),
            );
            return [];
          },
        })(productInput())
      ).status,
    ).toBe('timeout');
  });
  it('uses stable hashes and source aware refs', () => {
    expect(hashEvidenceRecord({ b: 2, a: 1 })).toBe(hashEvidenceRecord({ a: 1, b: 2 }));
    expect(evidenceRef('blog', 'same', 'abc')).toBe('blog/same/abc');
  });
  it('defers unrelated item facts and emits Algolia field negation syntax', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([
          { ...ring, scope: { kind: 'item', key: 'Ring' } },
          {
            field: 'product_type',
            scope: { kind: 'item', key: 'Earrings' },
            value: {
              kind: 'facet',
              attribute: 'Catalog_ProductType',
              values: ['Earrings'],
              operator: 'any',
            },
          },
        ]),
    });
    await retrieve(productInput());
    expect(search.mock.calls[0][0].filters).toEqual([
      { field: 'Catalog_ProductType', operator: 'eq', value: 'Ring' },
    ]);
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [{ hits: [] }] }), { status: 200 }),
      );
    await createAlgoliaEvidenceSearch({ appId: 'app', searchOnlyApiKey: 'key', fetch })({
      source: 'prod_catalog',
      query: '',
      count: 1,
      filters: [{ field: 'Catalog_ProductType', operator: 'neq', value: 'Earrings' }],
      signal: new AbortController().signal,
    });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(new URLSearchParams(body.requests[0].params).get('facetFilters')).toBe(
      '["Catalog_ProductType:-Earrings"]',
    );
  });
  it('propagates a parent abort separately from a timeout', async () => {
    const parent = new AbortController();
    const retrieve = createEvidenceRetriever({
      currentState: async () => state([ring]),
      signal: parent.signal,
      search: async ({ signal }) => {
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('abort'))),
        );
        return [];
      },
    });
    const pending = retrieve(productInput());
    parent.abort();
    expect((await pending).status).toBe('aborted');
  });
  it('verifies material facets on one material object and preserves exclusions', async () => {
    const materialFacts = [
      {
        field: 'material',
        scope: { kind: 'mission', key: null },
        value: {
          kind: 'facet',
          attribute: 'Catalog_MaterialInformation.MaterialType',
          values: ['Gold'],
          operator: 'any',
        },
      },
      {
        field: 'material',
        scope: { kind: 'mission', key: null },
        value: {
          kind: 'facet',
          attribute: 'Catalog_MaterialInformation.MaterialColor',
          values: ['White'],
          operator: 'any',
        },
      },
    ];
    const records = [
      { objectID: 'unknown', Catalog_MaterialInformation: [{ MaterialType: 'Gold' }] },
      {
        objectID: 'false',
        Catalog_MaterialInformation: [{ MaterialType: 'Gold' }, { MaterialColor: 'White' }],
      },
      {
        objectID: 'true',
        Catalog_MaterialInformation: [{ MaterialType: 'Gold', MaterialColor: 'White' }],
      },
    ];
    const retrieve = createEvidenceRetriever({
      search: async () => records,
      currentState: async () => state([ring, ...materialFacts]),
    });
    const response = await retrieve(productInput());
    expect(response.status).toBe('ok');
    expect(response.records.map((record) => record.objectID)).toEqual(['true']);
    const search = vi.fn().mockResolvedValue([]);
    await createEvidenceRetriever({
      search,
      currentState: async () => state([ring, ...materialFacts]),
    })(productInput({ count: 1 }));
    expect(search.mock.calls[0][0].count).toBe(3);
    const exclusion = createEvidenceRetriever({
      search: async () => [
        { objectID: 'unknown', Catalog_MaterialInformation: [{ MaterialType: 'Gold' }] },
      ],
      currentState: async () =>
        state([
          ring,
          { ...materialFacts[1], value: { ...materialFacts[1].value, operator: 'none' } },
        ]),
    });
    expect((await exclusion(productInput())).status).toBe('incomplete_evidence');
    const missing = createEvidenceRetriever({
      search: async () => [{ objectID: 'missing' }],
      currentState: async () => state([ring, ...materialFacts]),
    });
    expect((await missing(productInput())).status).toBe('incomplete_evidence');
  });
  it('never compiles an exclusion-field material fact with a non-none operator as an inclusion', async () => {
    // Independent review finding (d): the writer rejects exclusion+any, but the
    // compiler must reject it independently instead of compiling exclude:false.
    const badFact = {
      field: 'exclusion',
      scope: { kind: 'mission', key: null },
      value: {
        kind: 'facet',
        attribute: 'Catalog_MaterialInformation.MaterialColor',
        values: ['Yellow'],
        operator: 'any',
      },
    };
    const retrieve = createEvidenceRetriever({
      search: vi.fn().mockResolvedValue([]),
      currentState: async () => state([ring, badFact]),
    });
    const response = await retrieve(productInput());
    expect(response.status).toBe('unsupported_constraint');
    expect(
      (response as { unresolved?: Array<{ reason: string }> }).unresolved?.some((entry) =>
        entry.reason.includes('Exclusion facts on material attributes require operator none'),
      ),
    ).toBe(true);
  });
  it('compiles an exclusion-field material colour exclusion and excludes matching records', async () => {
    const exclusionFact = {
      field: 'exclusion',
      scope: { kind: 'mission', key: null },
      value: {
        kind: 'facet',
        attribute: 'Catalog_MaterialInformation.MaterialColor',
        values: ['Yellow'],
        operator: 'none',
      },
    };
    const retrieve = createEvidenceRetriever({
      search: async () => [
        {
          objectID: 'two-tone',
          Catalog_MaterialInformation: [
            { MaterialType: 'Silver', MaterialColor: 'White', MaterialPurity: 'Sterling' },
            { MaterialType: 'Gold', MaterialColor: 'Yellow', MaterialPurity: '14K' },
          ],
        },
        {
          objectID: 'clean',
          Catalog_MaterialInformation: [
            { MaterialType: 'Gold', MaterialColor: 'White', MaterialPurity: '14K' },
          ],
        },
        {
          objectID: 'no-material',
          Catalog_ProductType: 'Necklace',
        },
      ],
      currentState: async () => state([ring, exclusionFact]),
    });
    const response = await retrieve(productInput());
    expect(response.status).toBe('ok');
    expect(response.records.map((record) => record.objectID)).toEqual(['clean']);
    const noColour = createEvidenceRetriever({
      search: async () => [
        { objectID: 'missing-colour', Catalog_MaterialInformation: [{ MaterialType: 'Gold' }] },
      ],
      currentState: async () => state([ring, exclusionFact]),
    });
    expect((await noColour(productInput())).status).toBe('incomplete_evidence');
  });
  it('verifies typed material alternatives as complete same-object branches', async () => {
    const alternatives = {
      field: 'material',
      scope: { kind: 'mission', key: null },
      value: {
        kind: 'material_alternatives',
        alternatives: [
          { type: 'Silver', color: null, purity: 'Sterling', plating: null },
          {
            type: 'Gold',
            color: 'White',
            purity: null,
            plating: { presence: 'forbidden', purity: null },
          },
        ],
      },
    };
    const retrieve = createEvidenceRetriever({
      search: async () => [
        {
          objectID: 'silver',
          Catalog_MaterialInformation: [{ MaterialType: 'Silver', MaterialPurity: 'Sterling' }],
        },
        {
          objectID: 'gold',
          Catalog_MaterialInformation: [
            { MaterialType: 'Gold', MaterialColor: 'White', MaterialPlatingPurity: null },
          ],
        },
        {
          objectID: 'false',
          Catalog_MaterialInformation: [{ MaterialType: 'Gold' }, { MaterialColor: 'White' }],
        },
      ],
      currentState: async () => state([ring, alternatives]),
    });
    const response = await retrieve(productInput());
    expect(response.records.map((record) => record.objectID)).toEqual(['silver']);
    expect(response.unresolved).toHaveLength(2);
  });
  it.each(['10K', '14K', '18K', '24K'] as const)(
    'matches explicit %s white gold only when type, color and purity share one material entry',
    async (purity) => {
      const necklace = {
        field: 'product_type',
        scope: { kind: 'mission', key: null },
        value: {
          kind: 'facet',
          attribute: 'Catalog_ProductType',
          values: ['Necklace'],
          operator: 'any',
        },
      };
      const material = {
        field: 'material',
        scope: { kind: 'mission', key: null },
        value: {
          kind: 'material_alternatives',
          alternatives: [{ type: 'Gold', color: 'White', purity, plating: null }],
        },
      };
      const search = vi.fn().mockResolvedValue([
        {
          objectID: 'exact',
          Catalog_ProductType: 'Necklace',
          Catalog_MaterialInformation: [
            { MaterialType: 'Gold', MaterialColor: 'White', MaterialPurity: purity },
          ],
        },
        {
          objectID: 'mixed-components',
          Catalog_ProductType: 'Necklace',
          Catalog_MaterialInformation: [
            { MaterialType: 'Gold', MaterialColor: 'Yellow', MaterialPurity: purity },
            {
              MaterialType: 'Gold',
              MaterialColor: 'White',
              MaterialPurity: purity === '18K' ? '14K' : '18K',
            },
          ],
        },
      ]);
      const materialState = state([necklace, material]);
      const retrieve = createEvidenceRetriever({
        search,
        currentState: async () => materialState,
      });
      const response = await retrieve(productInput({ target: null }));
      expect(response.status, JSON.stringify(response.error)).toBe('ok');
      expect(response.records.map((record) => record.objectID)).toEqual(['exact']);
      expect(search).toHaveBeenCalledOnce();

      const untypedSearch = vi.fn();
      const untyped = createEvidenceRetriever({
        search: untypedSearch,
        currentState: async () =>
          state([
            necklace,
            { ...material, value: { kind: 'text', text: `${purity.toLowerCase()} white gold` } },
          ]),
      });
      const rejected = await untyped(productInput({ target: null }));
      expect(rejected.status).toBe('unsupported_constraint');
      expect(rejected.unresolved).toEqual([
        {
          field: 'material',
          reason:
            'Material/component correlation is not safely established by independent top-level facets',
        },
      ]);
      expect(untypedSearch).not.toHaveBeenCalled();
    },
  );

  // Fit compiler red tests (STAGE3-FIT-COMPILER-REPAIR-PLAN-2026-10-07).
  // The contract: a measurement fit fact compiles as POST-search verification
  // against the returned record's Inventory_AvailableSkuSizeNames (numeric
  // equality with the converted inches), never as an Algolia filter. Fail
  // closed when the record lacks the field or does not contain the expected
  // size. Unmapped units and product types outside the configured mapping stay
  // unresolved before any search with an honest reason. These tests are red
  // until the measurement branch lands in compile(); nothing here weakens
  // exact identity, source binding or the read-only index boundary.
  const fitFact = (patch: Record<string, unknown> = {}) => ({
    field: 'fit',
    scope: { kind: 'item', key: 'VG320P' },
    value: {
      kind: 'measurement',
      value: 22,
      unit: 'in',
      component: 'chain length',
      ...patch,
    },
  });
  const vg320pTarget = { kind: 'item', itemKey: 'VG320P', productType: 'Necklace' };
  const itemProductType = (productType: string) => ({
    field: 'product_type',
    scope: { kind: 'item', key: 'VG320P' },
    value: { kind: 'facet', attribute: 'Catalog_ProductType', values: [productType], operator: 'any' },
  });
  const vg320pRecord = {
    objectID: 'VG320P',
    Catalog_ProductType: 'Necklace',
    Inventory_AvailableSkuSizeNames: ['22 Inch'],
  };

  it('compiles an item-scoped 22 in fit as post-search verification and passes the exact record', async () => {
    const search = vi.fn().mockResolvedValue([vg320pRecord]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () => state([itemProductType('Necklace'), fitFact()]),
    });
    const response = await retrieve(productInput({ target: vg320pTarget }));
    expect(response.status, JSON.stringify(response.error)).toBe('ok');
    expect(response.records.map((record) => record.objectID)).toEqual(['VG320P']);
    // Verification runs after the search, not as a pre-search rejection.
    expect(search).toHaveBeenCalledOnce();
  });

  it('fails closed when the record lacks the size field or carries a different size', async () => {
    const missing = createEvidenceRetriever({
      search: async () => [
        { objectID: 'VG320P', Catalog_ProductType: 'Necklace' },
      ],
      currentState: async () => state([itemProductType('Necklace'), fitFact()]),
    });
    const missingResponse = await missing(productInput({ target: vg320pTarget }));
    expect(missingResponse.status).toBe('incomplete_evidence');

    const wrongSize = createEvidenceRetriever({
      search: async () => [
        { ...vg320pRecord, Inventory_AvailableSkuSizeNames: ['20 Inch'] },
      ],
      currentState: async () => state([itemProductType('Necklace'), fitFact()]),
    });
    const wrongResponse = await wrongSize(productInput({ target: vg320pTarget }));
    expect(wrongResponse.status).toBe('incomplete_evidence');
    expect(
      (wrongResponse as { unresolved?: Array<{ reason: string }> }).unresolved?.some((entry) =>
        entry.reason.toLowerCase().includes('size'),
      ),
    ).toBe(true);
  });

  it('does not mistake a numeric prefix in another unit for inches', async () => {
    for (const sizeName of ['22 cm', '22K', '22']) {
      const retrieve = createEvidenceRetriever({
        search: async () => [
          { ...vg320pRecord, Inventory_AvailableSkuSizeNames: [sizeName] },
        ],
        currentState: async () => state([itemProductType('Necklace'), fitFact()]),
      });
      const response = await retrieve(productInput({ target: vg320pTarget }));
      expect(response.status, sizeName).toBe('incomplete_evidence');
      expect(response.records, sizeName).toHaveLength(0);
    }
  });

  it('still rejects an item-scoped fit retry that drops the required target', async () => {
    const search = vi.fn().mockResolvedValue([vg320pRecord]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () => state([itemProductType('Necklace'), fitFact()]),
    });
    const response = await retrieve(productInput({ target: null }));
    expect(response.status).not.toBe('ok');
    expect(
      (response as { unresolved?: Array<{ reason: string }> }).unresolved?.some((entry) =>
        entry.reason.includes('Item-scoped hard requirement needs an explicit item target'),
      ),
    ).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it('keeps a non-necklace fit unresolved with an honest reason and no search', async () => {
    const search = vi.fn().mockResolvedValue([vg320pRecord]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () => state([itemProductType('Bracelet'), fitFact()]),
    });
    const response = await retrieve(
      productInput({ target: { kind: 'item', itemKey: 'VG320P', productType: 'Bracelet' } }),
    );
    // Bracelet target is accepted only because the brief carries an item-scoped
    // product_type fact for it; the fit mapping is still not configured for it.
    expect(response.status).toBe('unsupported_constraint');
    expect(
      (response as { unresolved?: Array<{ reason: string }> }).unresolved?.some((entry) =>
        entry.reason.toLowerCase().includes('bracelet'),
      ),
    ).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it('keeps ring and unknown fit units out of scope with an honest reason and no search', async () => {
    for (const unit of ['ring_us', 'ring_uk', 'unknown'] as const) {
      const search = vi.fn().mockResolvedValue([vg320pRecord]);
      const retrieve = createEvidenceRetriever({
        search,
        currentState: async () => state([itemProductType('Necklace'), fitFact({ value: 7, unit })]),
      });
      const response = await retrieve(productInput({ target: vg320pTarget }));
      expect(response.status, `unit ${unit}`).toBe('unsupported_constraint');
      expect(
        (
          response as { unresolved?: Array<{ reason: string }> }).unresolved?.some((entry) =>
          entry.reason.toLowerCase().includes(unit === 'unknown' ? 'unknown' : unit),
        ),
        `unit ${unit} reason`,
      ).toBe(true);
      expect(search, `unit ${unit} must not search`).not.toHaveBeenCalled();
    }
  });

  it('fails closed when multiple fit facts compile and any one expectation is unmet', async () => {
    // Multi-fit hole (round-3 review): compile() collects every fit fact, so
    // verification must require ALL of them, not just the first. Two fit
    // expectations on the same target where the record only satisfies one is a
    // verification failure, never a silent pass.
    const search = vi.fn().mockResolvedValue([vg320pRecord]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () =>
        state([itemProductType('Necklace'), fitFact(), fitFact({ value: 20, unit: 'in' })]),
    });
    const response = await retrieve(productInput({ target: vg320pTarget }));
    expect(response.status).toBe('incomplete_evidence');
    expect(
      (response as { unresolved?: Array<{ reason: string }> }).unresolved?.some((entry) =>
        entry.reason.toLowerCase().includes('size'),
      ),
    ).toBe(true);
    expect(response.records).toHaveLength(0);
  });

  it('converts cm and mm to inches by the recorded 2.54 cm rule and verifies numerically', async () => {
    // 1 in = 2.54 cm exactly; 55.88 cm = 22 in. The expected size is verified
    // against the record's own vocabulary (numeric equality), never invented
    // as a filter.
    const cm = createEvidenceRetriever({
      search: vi.fn().mockResolvedValue([vg320pRecord]),
      currentState: async () => state([itemProductType('Necklace'), fitFact({ value: 55.88, unit: 'cm' })]),
    });
    expect((await cm(productInput({ target: vg320pTarget }))).status).toBe('ok');

    const mm = createEvidenceRetriever({
      search: vi.fn().mockResolvedValue([vg320pRecord]),
      currentState: async () => state([itemProductType('Necklace'), fitFact({ value: 558.8, unit: 'mm' })]),
    });
    expect((await mm(productInput({ target: vg320pTarget }))).status).toBe('ok');
  });

  // Water-resistance projection red test (Father's F2 finding, 2026-10-07):
  // the evidence projection omitted Catalog_WaterResistanceRating (and
  // Catalog_PreviouslyOwned, required by the Father's record-level oracle)
  // even though the exact catalogue records carry them. The projection must
  // pass those fields through when the record has them. Query-level
  // attributesToRetrieve only; no index setting is touched.
  it('projects water-resistance rating and previously-owned flags onto returned records', async () => {
    const search = vi.fn().mockResolvedValue([
      {
        objectID: '1W9E1B',
        Catalog_ProductType: 'Wrist Watch',
        Catalog_WaterResistanceRating: '200 meters (20 ATM)',
        Catalog_PreviouslyOwned: false,
        Catalog_Condition: 'First Quality',
        Inventory_InStock: true,
        Pricing_ActivePrice: 161.09,
      },
    ]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () => state([ring]),
    });
    const response = await retrieve(productInput());
    expect(response.status).toBe('ok');
    // Product fields live under the evidence envelope's record wrapper.
    const record = (response.records[0] as { record: Record<string, unknown> }).record;
    expect(record.Catalog_WaterResistanceRating).toBe('200 meters (20 ATM)');
    expect(record.Catalog_PreviouslyOwned).toBe(false);
    // The projection must reach the outgoing query too: attributesToRetrieve is
    // a per-query parameter derived from the same constant, never an index
    // setting. Asserted through the Algolia adapter's injectable fetch, where
    // the exact-lookup GET carries the list; the injected search mock above
    // never sees it because the adapter applies it later.
    const capturedUrls: string[] = [];
    const adapter = createAlgoliaEvidenceSearch({
      appId: 'TESTAPPID',
      searchOnlyApiKey: 'search-only-key',
      fetch: (async (input: RequestInfo | URL) => {
        capturedUrls.push(String(input));
        return new Response(JSON.stringify({ hits: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await adapter({
      source: 'prod_catalog',
      query: '',
      count: 1,
      exactObjectIDs: ['1W9E1B'],
      filters: [],
      signal: new AbortController().signal,
    });
    expect(capturedUrls.join(' ')).toContain('Catalog_WaterResistanceRating');
    expect(capturedUrls.join(' ')).toContain('Catalog_PreviouslyOwned');
  });
});
