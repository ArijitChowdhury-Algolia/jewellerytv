import { describe, expect, it, vi } from 'vitest';
import { briefStateV3Schema, type BriefStateV3 } from '../../shared/briefSchema.js';
import {
  createAlgoliaEvidenceSearch,
  createEvidenceRetriever,
} from '../../server/concierge/retrieveEvidence.js';

const state = (): BriefStateV3 =>
  briefStateV3Schema.parse({
    version: 3,
    missionId: 'mission-1',
    revision: 2,
    facts: [
      {
        id: 'product-type',
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
        origin: 'spoken',
        evidence: {
          messageId: 'message-1',
          quote: 'a ring',
          explicit: true,
          verified: false,
        },
        status: 'active',
        revision: 1,
        createdAt: 'now',
      },
      {
        id: 'budget',
        field: 'budget',
        value: {
          kind: 'money',
          cents: 10000,
          currency: 'USD',
          operator: 'lt',
          basis: 'per-item',
        },
        scope: { kind: 'mission', key: null },
        strength: 'requirement',
        certainty: 'explicit',
        origin: 'spoken',
        evidence: {
          messageId: 'message-2',
          quote: 'under $100',
          explicit: true,
          verified: false,
        },
        status: 'active',
        revision: 1,
        createdAt: 'now',
      },
    ],
    processedTurns: [],
    tombstones: [],
    events: [],
  });

const blogInput = {
  source: 'blog',
  query: 'gold plating care',
  count: 2,
  missionId: 'mission-1',
  expectedRevision: 2,
  turnId: 'turn-3',
  target: null,
} as const;

const blogChunk = {
  objectID: 'shared-id',
  article_id: 'article-1',
  title: 'Caring for gold-plated jewellery',
  heading_path: 'Gold plating > Care',
  content: 'Gold plating is a surface layer. Remove jewellery before swimming.',
  canonical_url: 'https://www.jtv.com/blog/gold-plated-jewelry',
  source_role: 'education',
  content_hash: 'chunk-hash-1',
};

describe('blog evidence source boundaries', () => {
  it('queries the blog index without product constraints and preserves article and passage provenance', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ hits: [blogChunk] }] }), { status: 200 }),
    );
    const search = createAlgoliaEvidenceSearch({ appId: 'APP', searchOnlyApiKey: 'KEY', fetch });
    const retrieve = createEvidenceRetriever({ search, currentState: async () => state() });

    const result = await retrieve(blogInput);

    expect(result.status).toBe('ok');
    expect(result.effectiveFilters).toEqual([]);
    expect(result.records[0]).toMatchObject({
      source: 'blog',
      objectID: 'shared-id',
      record: {
        article_id: 'article-1',
        canonical_url: 'https://www.jtv.com/blog/gold-plated-jewelry',
        heading_path: 'Gold plating > Care',
        content: 'Gold plating is a surface layer. Remove jewellery before swimming.',
      },
    });
    expect(result.records[0].record).not.toHaveProperty('Pricing_ActivePrice');

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const request = JSON.parse(init.body as string).requests[0];
    expect(request.indexName).toBe('blog');
    const params = new URLSearchParams(request.params);
    expect(params.has('facetFilters')).toBe(false);
    expect(params.has('numericFilters')).toBe(false);
  });

  it('keeps product and article identities distinct when their objectIDs collide', async () => {
    const retrieve = createEvidenceRetriever({
      search: async ({ source }) =>
        source === 'blog'
          ? [blogChunk]
          : [{ objectID: 'shared-id', Catalog_TitleDescription: 'Gold ring' }],
      currentState: async () => state(),
    });

    const [product, blog] = await Promise.all([
      retrieve({ ...blogInput, source: 'prod_catalog', target: null }),
      retrieve(blogInput),
    ]);

    expect(product.records[0].objectID).toBe(blog.records[0].objectID);
    expect(product.records[0].source).toBe('prod_catalog');
    expect(blog.records[0].source).toBe('blog');
    expect(product.records[0].evidenceRef).not.toBe(blog.records[0].evidenceRef);
  });

  it('rejects a blog hit without a canonical source and passage locator', async () => {
    const retrieve = createEvidenceRetriever({
      search: async () => [
        {
          objectID: 'chunk-2',
          article_id: 'article-2',
          title: 'Gold plating',
          content: 'A sentence without a canonical URL or section.',
          source_role: 'education',
          content_hash: 'hash-2',
        },
      ],
      currentState: async () => state(),
    });

    const result = await retrieve(blogInput);

    expect(result.status).toBe('incomplete_evidence');
    expect(result.records).toEqual([]);
    expect(result.unresolved).toContainEqual(
      expect.objectContaining({ field: 'blog' }),
    );
  });
});
