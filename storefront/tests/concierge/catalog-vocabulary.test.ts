import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCatalogVocabulary, CATALOG_VOCABULARY_TTL_MS } from '../../server/concierge/catalogVocabulary';

const CONFIG = { appId: 'APPID123', apiKey: 'searchkey' };

function facetResponse(values: Record<string, Record<string, number>>) {
  return new Response(
    JSON.stringify({
      results: [{ hits: [], nbHits: 12345, facets: values }],
    }),
    { status: 200 },
  );
}

const upstreams: ReturnType<typeof vi.fn>[] = [];
afterEach(() => {
  upstreams.splice(0);
  vi.restoreAllMocks();
});

describe('createCatalogVocabulary', () => {
  it('builds vocabulary from a single read-only multi-facet query', async () => {
    const upstream = vi.fn(async () =>
      facetResponse({
        'Catalog_ProductType': { Ring: 500, Earrings: 300 },
        'Catalog_MaterialInformation.MaterialType': { Gold: 36245, Platinum: 98 },
      }),
    );
    const vocabulary = createCatalogVocabulary({ ...CONFIG, fetch: upstream as typeof fetch });
    const built = await vocabulary.get();
    expect(built.values['Catalog_ProductType']).toEqual(['Earrings', 'Ring']);
    expect(built.values['Catalog_MaterialInformation.MaterialType']).toEqual([
      'Gold',
      'Platinum',
    ]);
    expect(built.builtAt).toBeTruthy();
    // Read-only posture: single POST to the query endpoint, analytics disabled.
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/1/indexes/*/queries');
    expect(String(init.body)).toContain('analytics');
  });

  it('memoizes within the TTL window', async () => {
    const upstream = vi.fn(async () =>
      facetResponse({ 'Catalog_ProductType': { Ring: 1 } }),
    );
    let clock = 1_000_000;
    const vocabulary = createCatalogVocabulary({
      ...CONFIG,
      fetch: upstream as typeof fetch,
      now: () => clock,
    });
    await vocabulary.get();
    await vocabulary.get();
    expect(upstream).toHaveBeenCalledTimes(1);
    clock += CATALOG_VOCABULARY_TTL_MS - 1;
    await vocabulary.get();
    expect(upstream).toHaveBeenCalledTimes(1);
    clock += 1;
    await vocabulary.get();
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('invalidate forces a rebuild on next get', async () => {
    const upstream = vi.fn(async () =>
      facetResponse({ 'Catalog_ProductType': { Ring: 1 } }),
    );
    const vocabulary = createCatalogVocabulary({ ...CONFIG, fetch: upstream as typeof fetch });
    await vocabulary.get();
    vocabulary.invalidate();
    await vocabulary.get();
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('hasValue and availableValues expose the live truth', async () => {
    const upstream = vi.fn(async () =>
      facetResponse({
        'Catalog_ProductType': { Ring: 500 },
        'Catalog_MaterialInformation.MaterialType': { Gold: 36245 },
      }),
    );
    const vocabulary = createCatalogVocabulary({ ...CONFIG, fetch: upstream as typeof fetch });
    const built = await vocabulary.get();
    expect(built.hasValue('Catalog_ProductType', 'Ring')).toBe(true);
    expect(built.hasValue('Catalog_MaterialInformation.MaterialType', 'Platinum')).toBe(false);
    expect(built.availableValues('Catalog_ProductType')).toEqual(['Ring']);
    expect(built.availableValues('Catalog_MaterialInformation.MaterialColor')).toEqual([]);
  });

  it('surfaces upstream failure as a rejected build without caching it', async () => {
    const upstream = vi.fn(async () => new Response('boom', { status: 503 }));
    const vocabulary = createCatalogVocabulary({ ...CONFIG, fetch: upstream as typeof fetch });
    await expect(vocabulary.get()).rejects.toThrow();
    upstream.mockImplementation(async () => facetResponse({ 'Catalog_ProductType': { Ring: 1 } }));
    const built = await vocabulary.get();
    expect(built.values['Catalog_ProductType']).toEqual(['Ring']);
  });

  it('rejects responses whose facet payload is malformed', async () => {
    const upstream = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ hits: [] }] }), { status: 200 }),
    );
    const vocabulary = createCatalogVocabulary({ ...CONFIG, fetch: upstream as typeof fetch });
    await expect(vocabulary.get()).rejects.toThrow(/facet/i);
  });
});
