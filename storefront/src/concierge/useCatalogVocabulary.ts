import { useEffect, useState } from 'react';
import type { CatalogVocabulary } from '../../shared/concierge/vocabularyContract.js';

const VOCABULARY_TTL_MS = 12 * 60 * 60 * 1000;

let cache: { value: CatalogVocabulary; at: number } | null = null;
let inFlight: Promise<CatalogVocabulary | null> | null = null;

async function load(): Promise<CatalogVocabulary | null> {
  if (cache && Date.now() - cache.at < VOCABULARY_TTL_MS) return cache.value;
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const response = await fetch('/api/catalog-vocabulary');
        if (!response.ok) throw new Error('Catalogue vocabulary unavailable.');
        const payload = (await response.json()) as {
          builtAt: string;
          values: Record<string, string[]>;
        };
        const value: CatalogVocabulary = {
          values: payload.values,
          builtAt: payload.builtAt,
          hasValue: (attribute, v) => (payload.values[attribute] ?? []).includes(v),
          availableValues: (attribute) => payload.values[attribute] ?? [],
          isFilterable: (attribute) => attribute in payload.values,
        };
        cache = { value, at: Date.now() };
        return value;
      } catch {
        return null;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}

/** Module-level cached live vocabulary for components outside the tool runtime.
 * Returns null until loaded; callers fall back gracefully (never to stale code
 * for validation — the runtime writer owns validation and fails closed). */
export function useCatalogVocabulary(): CatalogVocabulary | null {
  const [value, setValue] = useState<CatalogVocabulary | null>(cache?.value ?? null);
  useEffect(() => {
    if (value) return;
    let cancelled = false;
    load().then((loaded) => {
      if (!cancelled && loaded) setValue(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return value;
}
