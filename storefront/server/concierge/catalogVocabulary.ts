import { INDEXES } from './retrieveEvidence.js';
import type { CatalogVocabulary, CatalogVocabularyCache } from '../../shared/concierge/vocabularyContract.js';

export const CATALOG_VOCABULARY_TTL_MS = 12 * 60 * 60 * 1000;

export type CatalogVocabularySnapshot = CatalogVocabulary;
export type { CatalogVocabularyCache };

/**
 * Live catalog vocabulary, derived read-only from the index. Replaces the frozen
 * hand-maintained copies (catalogueFactContract value enums, catalogueFacetValues.json):
 * what is filterable and which values exist are facts about the index, so the index
 * is asked directly, on a TTL, instead of being impersonated by code.
 *
 * Derivation: one empty multi-query with `facets: ['*']` and maxValuesPerFacet=1000,
 * analytics disabled — the same read-only interrogation that captured the Oct 2
 * snapshot, automated. Works with the search-only key; no settings ACL required.
 */

export function createCatalogVocabulary(options: {
  appId: string;
  apiKey: string;
  fetch?: typeof fetch;
  indexName?: string;
  ttlMs?: number;
  now?: () => number;
  maxValuesPerFacet?: number;
}): CatalogVocabularyCache {
  const request = options.fetch ?? fetch;
  const indexName = options.indexName ?? INDEXES.prod_catalog;
  const ttlMs = options.ttlMs ?? CATALOG_VOCABULARY_TTL_MS;
  const now = options.now ?? Date.now;
  const maxValuesPerFacet = options.maxValuesPerFacet ?? 1000;

  let cache: { snapshot: CatalogVocabularySnapshot; builtAtMs: number } | null = null;
  let inFlight: Promise<CatalogVocabularySnapshot> | null = null;

  const build = async (): Promise<CatalogVocabularySnapshot> => {
    const params = new URLSearchParams({
      query: '',
      hitsPerPage: '0',
      facets: JSON.stringify(['*']),
      maxValuesPerFacet: String(maxValuesPerFacet),
      analytics: 'false',
      clickAnalytics: 'false',
    });
    const response = await request(`https://${options.appId}.algolia.net/1/indexes/*/queries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-algolia-application-id': options.appId,
        'x-algolia-api-key': options.apiKey,
      },
      body: JSON.stringify({ requests: [{ indexName, params: params.toString() }] }),
    });
    if (!response.ok) throw new Error(`Catalog vocabulary upstream HTTP ${response.status}`);
    const payload = (await response.json()) as { results?: Array<{ facets?: unknown }> };
    const facets = payload.results?.[0]?.facets;
    if (!facets || typeof facets !== 'object')
      throw new Error('Catalog vocabulary response had no facet payload');
    const values: Record<string, string[]> = {};
    for (const [attribute, counts] of Object.entries(facets as Record<string, unknown>)) {
      if (!counts || typeof counts !== 'object') continue;
      values[attribute] = Object.keys(counts as Record<string, number>).sort();
    }
    const builtAt = new Date(now()).toISOString();
    const snapshot: CatalogVocabularySnapshot = {
      values,
      builtAt,
      hasValue: (attribute, value) => values[attribute]?.includes(value) ?? false,
      availableValues: (attribute) => values[attribute] ?? [],
      isFilterable: (attribute) => attribute in values,
    };
    cache = { snapshot, builtAtMs: now() };
    return snapshot;
  };

  return {
    get: () => {
      if (cache && now() - cache.builtAtMs < ttlMs) return Promise.resolve(cache.snapshot);
      if (!inFlight) {
        inFlight = build().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    invalidate: () => {
      cache = null;
    },
  };
}
