import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiServer } from '../../server/api';
import { createBriefStateV3, applyBriefOperationsV3 } from '../../shared/briefState';

const servers: ReturnType<typeof createApiServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

async function setup() {
  const upstream = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              hits: [
                {
                  objectID: 'ring-1',
                  Catalog_TitleDescription: 'Silver ring',
                  Catalog_ProductType: 'Ring',
                  Pricing_ActivePrice: 89.99,
                  Secret_InternalNote: 'never return',
                },
              ],
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const server = createApiServer({
    appId: 'TEST123',
    apiKey: 'search-only-test-key',
    developmentAgentId: 'development-agent',
    productionAgentId: 'production-agent',
    environment: 'development',
    fetch: upstream,
    // Warm-cache injection: in production the vocabulary scan runs once at
    // cold start; this test asserts on the search request that follows it.
    vocabulary: {
      get: async () => ({
        values: { 'Catalog_ProductType': ['Ring'] },
        builtAt: '2026-10-08T00:00:00.000Z',
        hasValue: (attribute: string, value: string) =>
          attribute === 'Catalog_ProductType' && value === 'Ring',
        availableValues: (attribute: string) =>
          attribute === 'Catalog_ProductType' ? ['Ring'] : [],
        isFilterable: (attribute: string) => attribute === 'Catalog_ProductType',
      }),
      invalidate: () => {},
    },
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  return {
    upstream,
    post: (body: unknown, origin?: string) =>
      fetch(`http://127.0.0.1:${address.port}/api/agent-evidence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify(body),
      }),
  };
}

function acceptedBrief() {
  const state = createBriefStateV3('mission-1');
  return applyBriefOperationsV3(state, {
    missionId: 'mission-1',
    expectedRevision: 0,
    turnId: 'turn-1',
    operations: [
      {
        type: 'add',
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
          origin: 'spoken',
          evidence: {
            messageId: 'message-1',
            quote: 'a ring',
            explicit: true,
            verified: false,
            sourceValidation: 'exact_user_message_substring',
          },
        },
      },
    ],
  });
}
const productInput = {
  source: 'prod_catalog',
  query: 'silver ring',
  count: 3,
  missionId: 'mission-1',
  expectedRevision: 1,
  turnId: 'turn-2',
  target: { kind: 'item', itemKey: 'Ring', productType: 'Ring' },
};

describe('API-only Agent Studio evidence route', () => {
  it('queries only the fixed product index and returns projected, source-bound evidence', async () => {
    const { upstream, post } = await setup();
    const response = await post({ input: productInput, brief: acceptedBrief() });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('ok');
    expect(result.records[0]).toMatchObject({ source: 'prod_catalog', objectID: 'ring-1' });
    expect(result.records[0].record.Secret_InternalNote).toBeUndefined();
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/1/indexes/*/queries');
    const request = JSON.parse(init.body as string).requests[0];
    expect(request.indexName).toBe('prod_catalog');
    const params = new URLSearchParams(request.params);
    expect(params.get('analytics')).toBe('false');
    expect(params.get('facetFilters')).toContain('Catalog_ProductType:Ring');
  });

  it('rejects arbitrary indices and model-supplied filters before any search', async () => {
    const { upstream, post } = await setup();
    expect(
      (await post({ input: { ...productInput, source: 'private' }, brief: acceptedBrief() }))
        .status,
    ).toBe(400);
    expect(
      (await post({ input: { ...productInput, filters: 'secret:true' }, brief: acceptedBrief() }))
        .status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('retrieves a blog passage without leaking product filters into guidance', async () => {
    const { upstream, post } = await setup();
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              hits: [
                {
                  objectID: 'chunk-1',
                  article_id: 'article-1',
                  title: 'Gold finishes',
                  heading_path: 'Gold finishes > Plating',
                  content: 'Gold plating is a surface layer.',
                  scope_text: 'This is general material guidance.',
                  canonical_url: 'https://example.com/gold-finishes',
                  source_role: 'education',
                  content_hash: 'source-hash',
                  Secret_InternalNote: 'never return',
                },
              ],
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    const input = {
      source: 'blog',
      query: 'gold plating',
      count: 3,
      missionId: 'mission-1',
      expectedRevision: 1,
      turnId: 'turn-2',
      target: null,
    };
    const response = await post({ input, brief: acceptedBrief() });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('ok');
    expect(result.records[0]).toMatchObject({
      source: 'blog',
      objectID: 'chunk-1',
      record: { article_id: 'article-1', canonical_url: 'https://example.com/gold-finishes' },
    });
    expect(result.records[0].record.Secret_InternalNote).toBeUndefined();
    const [, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    const request = JSON.parse(init.body as string).requests[0];
    expect(request.indexName).toBe('blog');
    const params = new URLSearchParams(request.params);
    expect(params.has('facetFilters')).toBe(false);
    expect(params.has('numericFilters')).toBe(false);
  });

  it('does not search with a stale revision or a foreign Origin', async () => {
    const { upstream, post } = await setup();
    const stale = await post({
      input: { ...productInput, expectedRevision: 0 },
      brief: acceptedBrief(),
    });
    expect(stale.status).toBe(200);
    expect((await stale.json()).status).toBe('stale_revision');
    expect(
      (await post({ input: productInput, brief: acceptedBrief() }, 'https://evil.example')).status,
    ).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
