import { z } from 'zod';
import { exactObjectId } from '../../shared/concierge/retrieval/schema.js';
import type { RetrieveEvidenceResult } from '../../shared/concierge/retrieval/types.js';
import {
  createAlgoliaEvidenceSearch,
  evidenceRef,
  hashEvidenceRecord,
  projection,
} from './retrieveEvidence.js';

const requestSchema = z
  .object({
    missionId: z.string().min(1).max(150),
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    turnId: z.string().min(1).max(150),
    exactObjectIDs: z
      .array(exactObjectId)
      .min(1)
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate product identities'),
  })
  .strict();

/** UI-only exact lookup. It never compiles shopper constraints or runs a catalogue query. */
export async function runExactProductRefreshRoute(
  raw: unknown,
  options: { appId: string; searchOnlyApiKey: string; fetch: typeof fetch; signal: AbortSignal },
): Promise<RetrieveEvidenceResult> {
  const input = requestSchema.parse(raw);
  const base = {
    source: 'prod_catalog' as const,
    missionId: input.missionId,
    revision: input.expectedRevision,
    expectedRevision: input.expectedRevision,
    turnId: input.turnId,
    effectiveFilters: [],
    unresolved: [],
  };
  if (options.signal.aborted) return { ...base, status: 'aborted', records: [] };
  const deadline = AbortSignal.timeout(15_000);
  const signal = AbortSignal.any([options.signal, deadline]);
  try {
    const hits = await createAlgoliaEvidenceSearch(options)({
      source: 'prod_catalog',
      query: '',
      count: input.exactObjectIDs.length,
      exactObjectIDs: input.exactObjectIDs,
      filters: [],
      signal,
    });
    if (options.signal.aborted) return { ...base, status: 'aborted', records: [] };
    if (deadline.aborted) return { ...base, status: 'timeout', records: [] };
    const byId = new Map(hits.map((hit) => [hit.objectID, hit]));
    if (
      byId.size !== input.exactObjectIDs.length ||
      input.exactObjectIDs.some((id) => !byId.has(id))
    )
      return { ...base, status: 'zero_hits', records: [] };
    const retrievedAt = new Date().toISOString();
    const records = input.exactObjectIDs.map((id) => {
      const record = projection('prod_catalog', byId.get(id)!);
      const contentHash = hashEvidenceRecord(record);
      return {
        source: 'prod_catalog' as const,
        objectID: id,
        contentHash,
        evidenceRef: evidenceRef('prod_catalog', id, contentHash),
        retrievedAt,
        record,
      };
    });
    return { ...base, status: 'ok', records };
  } catch {
    return {
      ...base,
      status: options.signal.aborted
        ? 'aborted'
        : deadline.aborted
          ? 'timeout'
          : 'upstream_failure',
      records: [],
    };
  }
}
