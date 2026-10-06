import type {
  EffectiveFilter,
  EvidenceRecord,
  RetrieveEvidenceResult,
} from '../../shared/concierge/retrieval/types.js';
import type { RetrieveEvidenceInput } from '../../shared/concierge/retrieval/schema.js';
export function makeResult(
  input: RetrieveEvidenceInput,
  revision: number,
  status: RetrieveEvidenceResult['status'],
  filters: EffectiveFilter[],
  unresolved: RetrieveEvidenceResult['unresolved'],
  records: EvidenceRecord[] = [],
  error?: RetrieveEvidenceResult['error'],
): RetrieveEvidenceResult {
  return {
    status,
    source: input.source,
    missionId: input.missionId,
    revision,
    turnId: input.turnId,
    expectedRevision: input.expectedRevision,
    effectiveFilters: filters,
    unresolved,
    records,
    ...(error ? { error } : {}),
  };
}
