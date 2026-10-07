import { describe, expect, it, vi } from 'vitest';
import { createBriefStateV3 } from '../../shared/briefState.js';
import { briefStateV3Schema } from '../../shared/briefSchema.js';
import { runExactProductRefreshRoute } from '../../server/concierge/exactProductRefreshRoute.js';
import { createEvidenceRetriever } from '../../server/concierge/retrieveEvidence.js';

const request = (id = 'saved:blue') => ({
  missionId: 'mission-refresh',
  expectedRevision: 1,
  turnId: 'refresh-turn',
  exactObjectIDs: [id],
});
const record = (id = 'saved:blue') => ({
  objectID: id,
  Catalog_TitleDescription: 'Blue necklace',
  Catalog_ProductType: 'Necklace',
  Pricing_ActivePrice: 125,
  Media_Images: [],
  contentHash: 'forged-upstream-value',
});
function options(fetchImpl: typeof fetch) {
  return {
    appId: 'APP',
    searchOnlyApiKey: 'search-only',
    fetch: fetchImpl,
    signal: new AbortController().signal,
  };
}

describe('exact product refresh route', () => {
  it('uses read-only exact prod_catalog lookup and emits the standard projected hash/ref', async () => {
    const upstream = vi.fn(async () => Response.json(record())) as unknown as typeof fetch;
    const refreshed = await runExactProductRefreshRoute(request(), options(upstream));
    expect(refreshed.status).toBe('ok');
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = (upstream as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/1/indexes/prod_catalog/saved%3Ablue?');
    expect(init.method).toBe('GET');
    expect(refreshed.records[0].record).not.toHaveProperty('contentHash');
    const brief = createBriefStateV3('mission-refresh');
    const ordinary = createEvidenceRetriever({
      search: async () => [record()],
      currentState: async () => brief,
    });
    const standard = await ordinary({
      source: 'prod_catalog',
      query: '',
      count: 1,
      exactObjectIDs: ['saved:blue'],
      missionId: brief.missionId,
      expectedRevision: brief.revision,
      turnId: 'standard-turn',
      target: null,
    });
    expect(standard.status).toBe('ok');
    expect(refreshed.records[0].contentHash).toBe(standard.records[0].contentHash);
    expect(refreshed.records[0].evidenceRef).toBe(standard.records[0].evidenceRef);
  });

  it('refreshes the exact ID even when a corrected item-scoped fact blocks ordinary search', async () => {
    const brief = briefStateV3Schema.parse({
      ...createBriefStateV3('mission-refresh'),
      revision: 1,
      facts: [
        {
          id: 'corrected-style',
          field: 'style',
          scope: { kind: 'item', key: 'gift-necklace' },
          status: 'active',
          revision: 1,
          createdAt: 'now',
          origin: 'spoken',
          certainty: 'explicit',
          strength: 'requirement',
          evidence: {
            messageId: 'correction',
            quote: 'understated',
            explicit: true,
            verified: true,
          },
          value: { kind: 'text', text: 'understated' },
        },
      ],
    });
    const ordinary = createEvidenceRetriever({
      search: async () => [record()],
      currentState: async () => brief,
    });
    const normal = await ordinary({
      source: 'prod_catalog',
      query: '',
      count: 1,
      exactObjectIDs: ['saved:blue'],
      missionId: brief.missionId,
      expectedRevision: brief.revision,
      turnId: 'normal-turn',
      target: { kind: 'item', itemKey: 'gift-necklace', productType: 'Necklace' },
    });
    expect(normal.status).toBe('unsupported_constraint');
    const upstream = vi.fn(async () => Response.json(record())) as unknown as typeof fetch;
    const refreshed = await runExactProductRefreshRoute(request(), options(upstream));
    expect(refreshed.status).toBe('ok');
    expect(refreshed.records.map((item) => item.objectID)).toEqual(['saved:blue']);
  });

  it('rejects extra source, duplicate IDs and malformed identities before any lookup', async () => {
    const upstream = vi.fn(async () => Response.json(record())) as unknown as typeof fetch;
    for (const invalid of [
      { ...request(), source: 'blog' },
      { ...request(), exactObjectIDs: ['saved:blue', 'saved:blue'] },
      { ...request(), exactObjectIDs: ['../other'] },
    ])
      await expect(runExactProductRefreshRoute(invalid, options(upstream))).rejects.toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('returns zero hits without partial records if an exact item is absent', async () => {
    const upstream = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;
    const result = await runExactProductRefreshRoute(request(), options(upstream));
    expect(result).toMatchObject({ status: 'zero_hits', records: [] });
  });
});
