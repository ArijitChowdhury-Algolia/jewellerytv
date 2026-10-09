/**
 * Live catalog vocabulary: which attributes are filterable and which values exist.
 * Derived read-only from the index (12h TTL server cache, served to the client via
 * /api/catalog-vocabulary). Replaces the frozen hand-maintained copies — the index
 * is the only source of truth for these facts; code keeps only the naming map
 * (shopper concept → attribute), which is our language, not the index's.
 */
export type CatalogVocabulary = {
  /** Filterable attribute → its live value list. */
  values: Record<string, string[]>;
  builtAt: string;
  hasValue: (attribute: string, value: string) => boolean;
  availableValues: (attribute: string) => string[];
  isFilterable: (attribute: string) => boolean;
};

export type CatalogVocabularyCache = {
  get: () => Promise<CatalogVocabulary>;
  invalidate: () => void;
};
