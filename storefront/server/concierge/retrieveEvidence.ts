import { createHash } from 'node:crypto';
import { briefStateV3Schema, type BriefStateV3 } from '../../shared/briefSchema.js';
import { retrieveEvidenceInputSchema } from '../../shared/concierge/retrieval/schema.js';
import type {
  EffectiveFilter,
  EvidenceRecord,
  EvidenceSource,
  RetrieveEvidenceResult,
} from '../../shared/concierge/retrieval/types.js';
import type { RetrieveEvidenceInput } from '../../shared/concierge/retrieval/schema.js';
import { materialMatch as verifyMaterial, type MaterialRequirement } from './materialEvidence.js';
import { makeResult } from './retrievalResult.js';
import {
  METAL_WATCH_BAND_MATERIALS,
  SUPPORTED_FACET_ATTRIBUTES,
} from '../../shared/concierge/catalogueFactContract.js';

const INDEXES: Record<EvidenceSource, string> = { prod_catalog: 'prod_catalog', blog: 'blog' };
const PRODUCT_FIELDS = new Set([
  'Catalog_ProductType',
  'Catalog_Brand',
  'Catalog_ConsumerProductCategories',
  'Catalog_ConsumerProductCategoryDisplayNames',
  'Catalog_PrimaryGemstoneAndPearlColorGroups',
  'Catalog_GemstoneInformation.GemstoneColorGroup',
  'Catalog_Motif',
  'Catalog_WatchPrimaryDialPrimaryColor',
  'Catalog_WatchBandType',
  'Catalog_WatchCaseShape',
]);
const MATERIAL_FIELDS = new Set(['material', 'Catalog_Material', 'Catalog_Materials']);
const MATERIAL_ATTRIBUTE_PATHS = new Set([
  'Catalog_MaterialInformation.MaterialType',
  'Catalog_MaterialInformation.MaterialColor',
  'Catalog_MaterialInformation.MaterialPurity',
]);
const PRODUCT_PROJECTION = [
  'objectID',
  'Catalog_ProductNumber',
  'Catalog_SKUNumbers',
  'Catalog_TitleDescription',
  'Catalog_LongDescription',
  'Catalog_ProductType',
  'Catalog_Condition',
  'Catalog_Motif',
  'Catalog_JewelryMaterialNavigationName',
  'Catalog_JewelryMaterialNavigationPurity',
  'Catalog_JewelryMaterialNavigationColor',
  'Catalog_MaterialInformation',
  'Catalog_GemstoneInformation',
  'Catalog_GemstoneInformationPrimary',
  'Catalog_PearlInformation',
  'Catalog_PearlInformationPrimary',
  'Catalog_BeadInformation',
  'Catalog_OtherMaterialInformation',
  'Catalog_BackingType',
  'Catalog_WatchDialInformation',
  'Catalog_WatchPrimaryDialPrimaryColor',
  'Catalog_WatchBandType',
  'Catalog_BandMaterialInformation',
  'Catalog_WatchCaseSize',
  'Catalog_WatchCaseShape',
  'Catalog_WatchStyle',
  'Catalog_EarringType',
  'Catalog_NecklaceType',
  'Catalog_PendantType',
  'Catalog_RingType',
  'Catalog_BraceletType',
  'Inventory_AvailableSkuSizes',
  'Inventory_AvailableSkuSizeNames',
  'Inventory_InStock',
  'Pricing_ActivePrice',
  'Pricing_PriceRange',
  'Pricing_PriceLabelName',
  'Media_Images',
  'Ratings_AverageRating',
];
const BLOG_PROJECTION = [
  'objectID',
  'article_id',
  'title',
  'heading_path',
  'content',
  'scope_text',
  'canonical_url',
  'source_role',
  'author',
  'published_at',
  'modified_at',
  'content_hash',
  'category',
  'tags',
  'language',
  'run_id',
  'fetched_at',
  'schema_version',
];
const BLOG_REQUIRED = [
  'article_id',
  'title',
  'content',
  'canonical_url',
  'source_role',
  'content_hash',
] as const;
export type EvidenceSearchRequest = {
  source: EvidenceSource;
  query: string;
  count: number;
  exactObjectIDs?: readonly string[] | null;
  filters: readonly EffectiveFilter[];
  signal: AbortSignal;
};
export type EvidenceSearch = (
  request: EvidenceSearchRequest,
) => Promise<readonly Record<string, unknown>[]>;
export type EvidenceRetrieverOptions = {
  search: EvidenceSearch;
  currentState: (missionId: string) => BriefStateV3 | Promise<BriefStateV3>;
  now?: () => string;
  timeoutMs?: number;
  signal?: AbortSignal;
};
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}
export function hashEvidenceRecord(record: Record<string, unknown>): string {
  return createHash('sha256').update(canonical(record)).digest('hex');
}
export function evidenceRef(source: EvidenceSource, objectID: string, contentHash: string): string {
  return `${source}/${encodeURIComponent(objectID)}/${contentHash}`;
}
export function projection(
  source: EvidenceSource,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const fields = source === 'blog' ? BLOG_PROJECTION : PRODUCT_PROJECTION;
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(raw, field)).map((field) => [field, raw[field]]),
  );
}
function watchFeatureStatus(
  record: Record<string, unknown>,
  filters: readonly EffectiveFilter[],
): 'match' | 'unknown' | 'conflict' {
  for (const filter of filters) {
    if (
      filter.field !== 'Catalog_WatchPrimaryDialPrimaryColor' &&
      filter.field !== 'Catalog_WatchBandType' &&
      filter.field !== 'Catalog_BandMaterialInformation.WatchBandMaterialName'
    )
      continue;
    const values =
      filter.field === 'Catalog_BandMaterialInformation.WatchBandMaterialName'
        ? Array.isArray(record.Catalog_BandMaterialInformation)
          ? record.Catalog_BandMaterialInformation.flatMap((entry) =>
              entry &&
              typeof entry === 'object' &&
              typeof (entry as Record<string, unknown>).WatchBandMaterialName === 'string'
                ? [(entry as Record<string, string>).WatchBandMaterialName]
                : [],
            )
          : []
        : typeof record[filter.field] === 'string'
          ? [record[filter.field] as string]
          : [];
    if (!values.length) return 'unknown';
    if (filter.operator === 'in') {
      if (!values.some((value) => filter.value.includes(value))) return 'conflict';
    } else if (filter.operator === 'eq') {
      if (!values.includes(String(filter.value))) return 'conflict';
    } else return 'unknown';
  }
  return 'match';
}
function missionProductTypes(state: BriefStateV3): string[] {
  const fact = state.facts.find(
    (f) =>
      f.status === 'active' &&
      f.field === 'product_type' &&
      f.scope.kind === 'mission' &&
      f.strength === 'requirement' &&
      f.certainty === 'explicit' &&
      f.value.kind === 'facet' &&
      f.value.attribute === 'Catalog_ProductType' &&
      f.value.operator === 'any',
  );
  return fact?.value.kind === 'facet' ? fact.value.values : [];
}
function targetAllowed(state: BriefStateV3, itemKey: string, productType: string): boolean {
  return (
    state.facts.some(
      (f) =>
        f.status === 'active' &&
        f.scope.kind === 'item' &&
        f.scope.key === itemKey &&
        f.strength === 'requirement' &&
        f.certainty === 'explicit' &&
        f.field === 'product_type' &&
        f.value.kind === 'facet' &&
        f.value.attribute === 'Catalog_ProductType' &&
        f.value.operator === 'any' &&
        f.value.values.includes(productType),
    ) ||
    (itemKey === productType && missionProductTypes(state).includes(productType))
  );
}
function compile(
  state: BriefStateV3,
  target: { itemKey: string; productType: string } | null,
): {
  filters: EffectiveFilter[];
  unresolved: Array<{ field: string; reason: string }>;
  material: MaterialRequirement[];
} {
  const filters: EffectiveFilter[] = [];
  const unresolved: Array<{ field: string; reason: string }> = [];
  const material: MaterialRequirement[] = [];
  const missionTypes = missionProductTypes(state);
  const isWatch =
    (target?.productType ?? (missionTypes.length === 1 ? missionTypes[0] : '')) === 'Wrist Watch';
  if (target)
    filters.push({ field: 'Catalog_ProductType', operator: 'eq', value: target.productType });
  else {
    if (missionTypes.length === 1)
      filters.push({ field: 'Catalog_ProductType', operator: 'eq', value: missionTypes[0] });
  }
  for (const f of state.facts) {
    if (
      f.field === 'recipient' ||
      f.field === 'occasion' ||
      f.field === 'design' ||
      f.field === 'style' ||
      f.field === 'item_reference'
    )
      continue;
    if (
      f.status !== 'active' ||
      f.strength !== 'requirement' ||
      f.certainty !== 'explicit' ||
      f.scope.kind === 'recipient' ||
      f.scope.kind === 'component'
    ) {
      if (
        f.strength === 'requirement' &&
        f.certainty === 'explicit' &&
        (f.scope.kind === 'recipient' || f.scope.kind === 'component')
      )
        unresolved.push({
          field: f.field,
          reason: 'Recipient or component scope is not provably bound to this item target',
        });
      continue;
    }
    if (f.scope.kind === 'item' && !target) {
      unresolved.push({
        field: f.field,
        reason: 'Item-scoped hard requirement needs an explicit item target',
      });
      continue;
    }
    if (f.scope.kind === 'item' && f.scope.key !== target?.itemKey) continue;
    if (f.field === 'product_type') {
      if (
        !target &&
        f.scope.kind === 'mission' &&
        f.value.kind === 'facet' &&
        f.value.values.length > 1
      )
        unresolved.push({
          field: f.field,
          reason: 'Multi-type product discovery needs an explicit target',
        });
      continue;
    }
    if (f.value.kind === 'money') {
      if (
        f.value.currency !== 'USD' ||
        f.value.basis === 'unresolved' ||
        f.value.operator === 'around'
      ) {
        unresolved.push({ field: f.field, reason: 'Only exact USD numeric bounds are supported' });
        continue;
      }
      filters.push({
        field: 'Pricing_ActivePrice',
        operator: f.value.operator,
        value: f.value.cents / 100,
      });
      continue;
    }
    if (f.field === 'watch_band_material') {
      if (!isWatch || f.value.kind !== 'watch_band_family' || f.value.family !== 'metal')
        unresolved.push({
          field: f.field,
          reason: 'Watch band material family is not supported for this target',
        });
      else
        filters.push({
          field: 'Catalog_BandMaterialInformation.WatchBandMaterialName',
          operator: 'in',
          value: [...METAL_WATCH_BAND_MATERIALS],
        });
      continue;
    }
    if (f.field === 'watch_dial_color' || f.field === 'watch_band_type') {
      const expected = SUPPORTED_FACET_ATTRIBUTES[f.field];
      if (
        !isWatch ||
        f.value.kind !== 'facet' ||
        f.value.attribute !== expected ||
        f.value.operator !== 'any' ||
        f.value.values.length !== 1
      )
        unresolved.push({
          field: f.field,
          reason: 'Watch feature is not an exact supported catalogue value',
        });
      else filters.push({ field: expected, operator: 'eq', value: f.value.values[0] });
      continue;
    }
    if (f.value.kind === 'material_alternatives') {
      material.push({ alternatives: f.value.alternatives, factId: f.id });
      continue;
    }
    if (
      f.field === 'material' ||
      MATERIAL_FIELDS.has(f.value.kind === 'facet' ? f.value.attribute : '') ||
      (f.field === 'exclusion' &&
        f.value.kind === 'facet' &&
        MATERIAL_ATTRIBUTE_PATHS.has(f.value.attribute))
    ) {
      if (f.value.kind === 'facet' && MATERIAL_ATTRIBUTE_PATHS.has(f.value.attribute)) {
        material.push({
          attribute: f.value.attribute.split('.').at(-1) as
            'MaterialType' | 'MaterialColor' | 'MaterialPurity',
          values: f.value.values,
          exclude: f.value.operator === 'none',
          factId: f.id,
        });
      } else
        unresolved.push({
          field: f.field,
          reason:
            'Material/component correlation is not safely established by independent top-level facets',
        });
      continue;
    }
    if (f.value.kind !== 'facet' || !PRODUCT_FIELDS.has(f.value.attribute)) {
      unresolved.push({
        field: f.field,
        reason: 'Constraint is not in the approved exact catalogue vocabulary',
      });
      continue;
    }
    const attribute = f.value.attribute;
    if (f.value.operator === 'none')
      filters.push(
        ...f.value.values.map((value) => ({
          field: attribute,
          operator: 'neq' as const,
          value,
        })),
      );
    else if (f.value.operator === 'any' && f.value.values.length === 1)
      filters.push({ field: f.value.attribute, operator: 'eq', value: f.value.values[0] });
    else
      unresolved.push({
        field: f.field,
        reason: 'Only exact single-value facet comparisons are supported',
      });
  }
  return { filters, unresolved, material };
}
export function createEvidenceRetriever(options: EvidenceRetrieverOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  return async function retrieveEvidence(raw: unknown): Promise<RetrieveEvidenceResult> {
    let input: RetrieveEvidenceInput;
    try {
      input = retrieveEvidenceInputSchema.parse(raw) as RetrieveEvidenceInput;
    } catch {
      const candidate = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      return {
        status: 'invalid_input',
        source: candidate.source === 'blog' ? 'blog' : 'prod_catalog',
        missionId: typeof candidate.missionId === 'string' ? candidate.missionId : '',
        revision: 0,
        turnId: typeof candidate.turnId === 'string' ? candidate.turnId : '',
        expectedRevision:
          typeof candidate.expectedRevision === 'number' ? candidate.expectedRevision : 0,
        effectiveFilters: [],
        unresolved: [],
        records: [],
        error: { code: 'INVALID_INPUT', message: 'Evidence request failed strict validation' },
      };
    }
    let state: BriefStateV3;
    try {
      state = briefStateV3Schema.parse(await options.currentState(input.missionId));
    } catch {
      return makeResult(input, input.expectedRevision, 'upstream_failure', [], [], [], {
        code: 'STATE_UNAVAILABLE',
        message: 'Current mission state could not be resolved',
      });
    }
    if (state.missionId !== input.missionId || state.revision !== input.expectedRevision)
      return makeResult(input, state.revision, 'stale_revision', [], [], [], {
        code: 'STALE_REVISION',
        message: 'Evidence request revision is no longer current',
      });
    if (
      input.source === 'prod_catalog' &&
      input.target !== null &&
      !targetAllowed(state, input.target.itemKey, input.target.productType)
    )
      return makeResult(
        input,
        state.revision,
        'unsupported_constraint',
        [],
        [
          {
            field: 'target',
            reason: 'Target is not an accepted item scope or mission product type',
          },
        ],
        [],
        { code: 'TARGET_MISMATCH', message: 'Product target is not bound to the accepted brief' },
      );
    const compiled =
      input.source === 'blog'
        ? { filters: [], unresolved: [], material: [] }
        : compile(
            state,
            input.target
              ? { itemKey: input.target.itemKey, productType: input.target.productType }
              : null,
          );
    if (compiled.unresolved.length)
      return makeResult(
        input,
        state.revision,
        'unsupported_constraint',
        compiled.filters,
        compiled.unresolved,
        [],
        {
          code: 'UNSUPPORTED_CONSTRAINT',
          message: 'One or more accepted constraints could not be compiled safely',
        },
      );
    const controller = new AbortController();
    const parentAbort = () => controller.abort();
    if (options.signal?.aborted)
      return makeResult(input, state.revision, 'aborted', compiled.filters, [], [], {
        code: 'ABORTED',
        message: 'Evidence retrieval was cancelled',
      });
    options.signal?.addEventListener('abort', parentAbort, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? 15000);
    const candidateCount = Math.min(36, input.count * 3);
    try {
      const hits = await options.search({
        source: input.source,
        query: input.query,
        count: input.exactObjectIDs?.length ?? candidateCount,
        exactObjectIDs: input.exactObjectIDs,
        filters: compiled.filters,
        signal: controller.signal,
      });
      if (options.signal?.aborted)
        return makeResult(input, state.revision, 'aborted', compiled.filters, [], [], {
          code: 'ABORTED',
          message: 'Evidence retrieval was cancelled',
        });
      try {
        state = briefStateV3Schema.parse(await options.currentState(input.missionId));
      } catch {
        return makeResult(input, state.revision, 'upstream_failure', compiled.filters, [], [], {
          code: 'STATE_UNAVAILABLE',
          message: 'Current mission state could not be resolved',
        });
      }
      if (options.signal?.aborted)
        return makeResult(input, state.revision, 'aborted', compiled.filters, [], [], {
          code: 'ABORTED',
          message: 'Evidence retrieval was cancelled',
        });
      if (state.missionId !== input.missionId || state.revision !== input.expectedRevision)
        return makeResult(input, state.revision, 'stale_revision', compiled.filters, [], [], {
          code: 'STALE_REVISION',
          message: 'Mission changed during evidence retrieval',
        });
      const retrievedAt = now();
      const incomplete: Array<{ field: string; reason: string }> = [];
      const materialUnknown: Array<{ field: string; reason: string }> = [];
      const watchUnknown: Array<{ field: string; reason: string }> = [];
      const exactIDs = input.exactObjectIDs ? new Set(input.exactObjectIDs) : null;
      const records = hits.flatMap((raw): EvidenceRecord[] => {
        if (exactIDs && (typeof raw.objectID !== 'string' || !exactIDs.has(raw.objectID)))
          return [];
        const record = projection(input.source, raw);
        const materialStatus =
          input.source === 'prod_catalog' ? verifyMaterial(record, compiled.material) : 'match';
        if (materialStatus === 'unknown') {
          materialUnknown.push({
            field: 'material',
            reason: 'Catalog_MaterialInformation is missing or incomplete',
          });
          return [];
        }
        if (materialStatus === 'conflict') return [];
        if (input.source === 'prod_catalog') {
          const watchStatus = watchFeatureStatus(record, compiled.filters);
          if (watchStatus === 'unknown') {
            watchUnknown.push({
              field: 'watch_feature',
              reason: 'A required watch feature is missing from this product record',
            });
            return [];
          }
          if (watchStatus === 'conflict') return [];
        }
        if (input.source === 'blog') {
          const missing: string[] = BLOG_REQUIRED.filter(
            (field) => typeof record[field] !== 'string' || !record[field].trim(),
          );
          if (!(
            (typeof record.heading_path === 'string' && record.heading_path.trim()) ||
            (typeof record.scope_text === 'string' && record.scope_text.trim())
          ))
            missing.push('heading_path or scope_text');
          if (missing.length) {
            incomplete.push({
              field: 'blog',
              reason: `Required evidence fields missing: ${missing.join(', ')}`,
            });
            return [];
          }
        }
        const id =
          typeof record.objectID === 'string'
            ? record.objectID
            : typeof record.article_id === 'string'
              ? record.article_id
              : undefined;
        if (!id) return [];
        const contentHash = hashEvidenceRecord(record);
        return [
          {
            source: input.source,
            objectID: id,
            contentHash,
            retrievedAt,
            evidenceRef: evidenceRef(input.source, id, contentHash),
            record,
          },
        ];
      });
      const returned = records.slice(0, input.count);
      if ((incomplete.length || watchUnknown.length) && !returned.length)
        return makeResult(input, state.revision, 'incomplete_evidence', compiled.filters, [
          ...incomplete,
          ...materialUnknown,
          ...watchUnknown,
        ]);
      return makeResult(
        input,
        state.revision,
        returned.length
          ? 'ok'
          : materialUnknown.length || watchUnknown.length
            ? 'incomplete_evidence'
            : 'zero_hits',
        compiled.filters,
        [...incomplete, ...materialUnknown, ...watchUnknown],
        returned,
      );
    } catch (error) {
      const status =
        error &&
        typeof error === 'object' &&
        'status' in error &&
        Number.isInteger((error as { status?: unknown }).status)
          ? Number((error as { status: number }).status)
          : undefined;
      const upstreamStatus =
        status !== undefined && status >= 400 && status <= 599 ? status : undefined;
      return makeResult(
        input,
        state.revision,
        timedOut ? 'timeout' : options.signal?.aborted ? 'aborted' : 'upstream_failure',
        compiled.filters,
        [],
        [],
        {
          code: timedOut
            ? 'TIMEOUT'
            : options.signal?.aborted
              ? 'ABORTED'
              : upstreamStatus
                ? `UPSTREAM_HTTP_${upstreamStatus}`
                : 'UPSTREAM_FAILURE',
          message: timedOut
            ? 'Evidence retrieval timed out'
            : options.signal?.aborted
              ? 'Evidence retrieval was cancelled'
              : upstreamStatus
                ? 'Evidence source returned an upstream HTTP error'
                : 'Evidence source failed',
          ...(upstreamStatus ? { upstreamStatus } : {}),
        },
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', parentAbort);
    }
  };
}
export function retrieveEvidence(raw: unknown, options: EvidenceRetrieverOptions) {
  return createEvidenceRetriever(options)(raw);
}
export function createAlgoliaEvidenceSearch(options: {
  appId: string;
  searchOnlyApiKey: string;
  fetch?: typeof fetch;
}): EvidenceSearch {
  if (!/^[A-Za-z0-9]+$/.test(options.appId) || !options.searchOnlyApiKey.trim())
    throw new Error('Search-only Algolia credentials are required');
  const request = options.fetch ?? fetch;
  class UpstreamHttpError extends Error {
    constructor(readonly status: number) {
      super(`Algolia upstream HTTP ${status}`);
    }
  }
  const numericOperator: Record<string, string> = {
    lt: '<',
    lte: '<=',
    gt: '>',
    gte: '>=',
    eq: '=',
  };
  return async ({ source, query, count, exactObjectIDs = null, filters, signal }) => {
    if (source === 'blog' && exactObjectIDs !== null)
      throw new Error('Blog exact object lookup is not supported');
    if (exactObjectIDs?.length) {
      const records = await Promise.all(
        exactObjectIDs.map(async (objectID) => {
          const params = new URLSearchParams({
            attributesToRetrieve: (source === 'blog' ? BLOG_PROJECTION : PRODUCT_PROJECTION).join(
              ',',
            ),
          });
          const response = await request(
            `https://${options.appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(INDEXES[source])}/${encodeURIComponent(objectID)}?${params.toString()}`,
            {
              method: 'GET',
              headers: {
                'x-algolia-application-id': options.appId,
                'x-algolia-api-key': options.searchOnlyApiKey,
              },
              signal,
              redirect: 'error',
            },
          );
          if (response.status === 404) return null;
          if (!response.ok) throw new UpstreamHttpError(response.status);
          const record = (await response.json()) as Record<string, unknown>;
          return record.objectID === objectID ? record : null;
        }),
      );
      return records.filter((record): record is Record<string, unknown> => record !== null);
    }
    const numeric = filters
      .filter((f) => f.field === 'Pricing_ActivePrice')
      .map((f) => {
        if (f.operator === 'in') throw new Error('Unsupported numeric operator: in');
        const operator = numericOperator[f.operator];
        if (!operator) throw new Error(`Unsupported numeric operator: ${f.operator}`);
        return `${f.field}${operator}${f.value}`;
      });
    const facets = filters
      .filter((f) => f.field !== 'Pricing_ActivePrice')
      .map((f) =>
        f.operator === 'in'
          ? f.value.map((value) => `${f.field}:${value}`)
          : `${f.field}:${f.operator === 'neq' ? '-' : ''}${String(f.value)}`,
      );
    const params = new URLSearchParams({
      query,
      hitsPerPage: String(count),
      attributesToRetrieve: JSON.stringify(
        source === 'blog' ? BLOG_PROJECTION : PRODUCT_PROJECTION,
      ),
      analytics: 'false',
      clickAnalytics: 'false',
      ...(numeric.length ? { numericFilters: JSON.stringify(numeric) } : {}),
      ...(facets.length ? { facetFilters: JSON.stringify(facets) } : {}),
    });
    const response = await request(`https://${options.appId}.algolia.net/1/indexes/*/queries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-algolia-application-id': options.appId,
        'x-algolia-api-key': options.searchOnlyApiKey,
      },
      body: JSON.stringify({
        requests: [{ indexName: INDEXES[source], params: params.toString() }],
      }),
      signal,
      redirect: 'error',
    });
    if (!response.ok) throw new UpstreamHttpError(response.status);
    const payload = (await response.json()) as {
      results?: Array<{ hits?: Record<string, unknown>[] }>;
    };
    return payload.results?.[0]?.hits ?? [];
  };
}
export { INDEXES };
