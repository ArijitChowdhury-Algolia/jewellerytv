import { normalizeProduct } from '../catalog';
import type {
  EvidenceRecord,
  RetrieveEvidenceResult,
} from '../../shared/concierge/retrieval/types.js';
import type { SourceBoundProduct } from '../../shared/concierge/sessionContract.js';
import type { createSessionStore } from './sessionStore.js';

type Store = ReturnType<typeof createSessionStore>;
type FetchEvidence = (body: unknown, signal?: AbortSignal) => Promise<RetrieveEvidenceResult>;
const refreshFailure =
  'Current catalogue details could not be refreshed. Previously saved information is still shown.';

function validRecord(record: EvidenceRecord, requested: string[]): boolean {
  if (
    record.source !== 'prod_catalog' ||
    !requested.includes(record.objectID) ||
    record.record.objectID !== record.objectID ||
    !record.contentHash ||
    record.evidenceRef !==
      `prod_catalog/${encodeURIComponent(record.objectID)}/${record.contentHash}`
  )
    return false;
  try {
    normalizeProduct(record.record);
    return true;
  } catch {
    return false;
  }
}

/** Refresh exact IDs through the source-bound read path without creating agent dialogue. */
export function createExactProductRefresh(store: Store, fetchExactProducts: FetchEvidence) {
  let refreshError = '';
  let refreshing = false;
  let generation = 0;
  async function notify() {
    const current = store.getSnapshot();
    if (current)
      await store.transact({
        expectedRevision: current.brief.revision,
        apply: (session) => session,
      });
  }
  async function refreshProducts(ids: string[]) {
    const state = store.getSnapshot();
    if (!state) return;
    const requested = [...new Set(ids)];
    if (!requested.length) return;
    const known = new Set(
      [...state.products, ...state.selectionRecords].map((item) => item.objectID),
    );
    if (
      requested.length > 12 ||
      requested.some((id) => !known.has(id) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(id))
    ) {
      refreshError = refreshFailure;
      await notify();
      return;
    }
    const requestGeneration = ++generation;
    refreshing = true;
    refreshError = '';
    await notify();
    try {
      const records: EvidenceRecord[] = [];
      for (let offset = 0; offset < requested.length; offset += 3) {
        const exactObjectIDs = requested.slice(offset, offset + 3);
        const turnId = `workspace-refresh-${requestGeneration}-${offset}`;
        const result = await fetchExactProducts({
          exactObjectIDs,
          missionId: state.missionId,
          expectedRevision: state.brief.revision,
          turnId,
        });
        if (
          result.status !== 'ok' ||
          result.source !== 'prod_catalog' ||
          result.missionId !== state.missionId ||
          result.revision !== state.brief.revision ||
          result.turnId !== turnId ||
          result.records.length !== exactObjectIDs.length ||
          result.records.some((record) => !validRecord(record, exactObjectIDs)) ||
          new Set(result.records.map((record) => record.objectID)).size !== exactObjectIDs.length
        )
          throw new Error('Invalid exact product refresh');
        records.push(...result.records);
      }
      if (requestGeneration !== generation) return;
      const result = await store.transact({
        expectedRevision: state.brief.revision,
        apply: (current) => {
          if (current.missionId !== state.missionId) return current;
          const refreshed = new Map(records.map((record) => [record.objectID, record]));
          const canonical = new Map(
            [...current.products, ...current.selectionRecords]
              .filter((item) => refreshed.has(item.objectID))
              .map((item) => [item.objectID, item]),
          );
          for (const record of records) {
            const previous = canonical.get(record.objectID);
            if (!previous) continue;
            canonical.set(record.objectID, {
              ...previous,
              raw: record.record,
              binding: 'evidence_bound',
              contentHash: record.contentHash,
              evidenceRef: record.evidenceRef,
              observedAt: record.retrievedAt,
            });
          }
          const update = (item: SourceBoundProduct) => canonical.get(item.objectID) ?? item;
          const proposalChanged = current.committedProposal?.groups.some((group) =>
            group.lines.some((line) => {
              const record = refreshed.get(line.objectID);
              return record && record.contentHash !== line.contentHash;
            }),
          );
          return {
            ...current,
            products: current.products.map(update),
            selectionRecords: current.selectionRecords.map(update),
            committedProposal: proposalChanged ? null : current.committedProposal,
            evidence: (current.evidence ?? []).map((item) => {
              const record = refreshed.get(item.objectID);
              return record
                ? { ...item, contentHash: record.contentHash, evidenceRef: record.evidenceRef }
                : item;
            }),
          };
        },
      });
      if (!result.ok) throw new Error('Could not save refreshed product details');
    } catch {
      if (requestGeneration === generation && store.getSnapshot()?.missionId === state.missionId)
        refreshError = refreshFailure;
    } finally {
      if (requestGeneration === generation) {
        refreshing = false;
        await notify();
      }
    }
  }
  return { refreshProducts, isRefreshing: () => refreshing, getError: () => refreshError };
}
