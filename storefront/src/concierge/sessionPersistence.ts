import {
  briefStateSchema,
  briefStateV3Schema,
} from '../../shared/briefSchema.js';
import { createBriefStateV3, migrateBriefStateV2ToV3 } from '../../shared/briefState.js';
import {
  validateConciergeSession,
  type ConciergeSession,
  type SourceBoundProduct,
} from '../../shared/concierge/sessionContract.js';

export const LEGACY_SESSION_KEY = 'jtv.shopping.v1';
export const V3_SESSION_KEY = 'jtv.shopping.v3';
export const LEGACY_BACKUP_KEY = 'jtv.shopping.v1.backup.v3';
export const V3_BACKUP_KEY = 'jtv.shopping.v3.backup.canonical';
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};
export type PersistedSession = ConciergeSession;
export type SessionLoad = {
  state: PersistedSession | null;
  legacyRaw: string | null;
  v3Raw: string | null;
};
export type AppliedMutation = { state: PersistedSession; result: { status: string } };
export type ResetResult =
  | { ok: true; state: PersistedSession }
  | {
      ok: false;
      reason: 'missing_state' | 'corrupt_state' | 'invalid_mutation' | 'write_failed';
    };

function parse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}
function normalizeProducts(entries: unknown): SourceBoundProduct[] | null {
  if (entries === undefined) return [];
  if (!Array.isArray(entries) || entries.length > 12) return null;
  const products: SourceBoundProduct[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as Record<string, unknown>;
    const nested = e.product && typeof e.product === 'object'
      ? (e.product as Record<string, unknown>).raw
      : undefined;
    const candidate = nested ?? e.raw;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const raw = candidate as Record<string, unknown>;
    const id = typeof e.objectID === 'string' ? e.objectID : raw.objectID;
    if (typeof id !== 'string' || !id || raw.objectID !== id) return null;
    if (e.quantity !== undefined && (!Number.isInteger(e.quantity) || Number(e.quantity) < 1 || Number(e.quantity) > 10)) return null;
    if (e.observedAt !== undefined && e.observedAt !== null && typeof e.observedAt !== 'string') return null;
    products.push({
      sourceIndex: 'prod_catalog',
      objectID: id,
      contentHash: typeof e.contentHash === 'string' && e.contentHash ? e.contentHash : null,
      evidenceRef: typeof e.evidenceRef === 'string' && e.evidenceRef ? e.evidenceRef : null,
      binding: e.binding === 'evidence_bound' && typeof e.contentHash === 'string' && e.contentHash && typeof e.evidenceRef === 'string' && e.evidenceRef
        ? 'evidence_bound'
        : 'legacy_unbound',
      raw,
      quantity: e.quantity === undefined ? 1 : Number(e.quantity),
      observedAt: typeof e.observedAt === 'string' && e.observedAt ? e.observedAt : null,
    } as SourceBoundProduct);
  }
  return products;
}
function migrateLegacy(value: Record<string, unknown>): PersistedSession | null {
  try {
    if (value.version !== 1 || typeof value.missionId !== 'string' || !value.brief) return null;
    const brief = briefStateSchema.parse(value.brief);
    if (brief.missionId !== value.missionId) return null;
    const v3 = migrateBriefStateV2ToV3(brief);
    const products = normalizeProducts(value.products);
    if (!products) return null;
    return validateConciergeSession({
      version: 3,
      missionId: value.missionId,
      brief: v3,
      products,
      selectionRecords: [],
      compareIds: Array.isArray(value.compareIds) ? value.compareIds : [],
      activeView: 'saved',
      receipts: [],
    }) as PersistedSession | null;
  } catch {
    return null;
  }
}
function parseV3(value: Record<string, unknown> | null): PersistedSession | null {
  try {
    if (!value || value.version !== 3 || typeof value.missionId !== 'string') return null;
    for (const collection of [value.products, value.selectionRecords, value.evidence]) {
      if (
        Array.isArray(collection) &&
        collection.some(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            'sourceIndex' in entry &&
            (entry as Record<string, unknown>).sourceIndex !== 'prod_catalog',
        )
      )
        return null;
    }
    const brief = briefStateV3Schema.parse(value.brief);
    if (brief.missionId !== value.missionId) return null;
    const products = normalizeProducts(value.products);
    const selectionRecords = normalizeProducts(value.selectionRecords);
    if (!products || !selectionRecords) return null;
    const normalizeIds = (input: unknown, max: number) => {
      if (input === undefined) return [];
      if (!Array.isArray(input) || input.length > max || input.some((id) => typeof id !== 'string')) return null;
      return input as string[];
    };
    const compareIds = normalizeIds(value.compareIds, 3);
    if (!compareIds) return null;
    const canonical = {
      version: 3,
      missionId: value.missionId,
      brief,
      products,
      selectionRecords,
      compareIds,
      activeView: String(value.activeView) === 'combination'
        ? 'saved'
        : ['discover', 'saved', 'compare'].includes(String(value.activeView))
          ? value.activeView
          : 'discover',
      receipts: Array.isArray(value.receipts) ? value.receipts : [],
      ...(value.committedProposal &&
      typeof value.committedProposal === 'object' &&
      Array.isArray((value.committedProposal as Record<string, unknown>).groups)
        ? { committedProposal: value.committedProposal }
        : {}),
      ...(Array.isArray(value.evidence)
        ? {
            evidence: value.evidence
              .filter(
                (e) =>
                  e &&
                  typeof e === 'object' &&
                  typeof (e as Record<string, unknown>).evidenceRef === 'string' &&
                  typeof (e as Record<string, unknown>).objectID === 'string' &&
                  typeof (e as Record<string, unknown>).contentHash === 'string',
              )
              .map((e) => ({
                evidenceRef: (e as Record<string, unknown>).evidenceRef as string,
                sourceIndex: 'prod_catalog',
                objectID: (e as Record<string, unknown>).objectID as string,
                contentHash: (e as Record<string, unknown>).contentHash as string,
              })),
          }
        : {}),
    };
    return validateConciergeSession(canonical) as PersistedSession | null;
  } catch {
    return null;
  }
}
export function createSessionPersistence(storage: StorageLike, initialMissionId?: string) {
  let transactionQueue = Promise.resolve();
  function writeSession(current: SessionLoad, serialized: string) {
    if (current.legacyRaw !== null && storage.getItem(LEGACY_BACKUP_KEY) === null)
      storage.setItem(LEGACY_BACKUP_KEY, current.legacyRaw);
    if (current.v3Raw !== null && storage.getItem(V3_BACKUP_KEY) === null)
      storage.setItem(V3_BACKUP_KEY, current.v3Raw);
    storage.setItem(V3_SESSION_KEY, serialized);
  }
  function load(): SessionLoad {
    const legacyRaw = storage.getItem(LEGACY_SESSION_KEY),
      v3Raw = storage.getItem(V3_SESSION_KEY);
    // A present but corrupt v3 record is newer state with an integrity failure.
    // Never silently replace it with older v1 bytes.
    const state =
      v3Raw !== null
        ? parseV3(parse(v3Raw))
        : legacyRaw !== null
          ? migrateLegacy(parse(legacyRaw) ?? {})
          : initialMissionId
            ? (validateConciergeSession({
                version: 3,
                missionId: initialMissionId,
                brief: createBriefStateV3(initialMissionId),
                products: [],
                selectionRecords: [],
                compareIds: [],
                activeView: 'discover',
                receipts: [],
              }) as PersistedSession | null)
            : null;
    return { state, legacyRaw, v3Raw };
  }
  function commitMutation(
    mutator: (state: PersistedSession) => PersistedSession,
  ):
    | { ok: true; state: PersistedSession }
    | { ok: false; reason: 'missing_state' | 'invalid_mutation' | 'write_failed' } {
    const current = load();
    if (!current.state) return { ok: false, reason: 'missing_state' };
    let next: PersistedSession;
    try {
      next = mutator(structuredClone(current.state));
      next = { ...next, version: 3, brief: briefStateV3Schema.parse(next.brief) };
      if (next.missionId !== next.brief.missionId) throw new Error('mission_mismatch');
      if (!validateConciergeSession(next)) throw new Error('invalid_session');
    } catch {
      return { ok: false, reason: 'invalid_mutation' };
    }
    if (JSON.stringify(current.state) === JSON.stringify(next)) return { ok: true, state: next };
    const serialized = JSON.stringify(next);
    if (current.v3Raw === serialized) return { ok: true, state: next };
    try {
      writeSession(current, serialized);
      return { ok: true, state: next };
    } catch {
      return { ok: false, reason: 'write_failed' };
    }
  }
  function rollback(): SessionLoad {
    const raw = storage.getItem(LEGACY_BACKUP_KEY);
    return {
      state: migrateLegacy(parse(raw) ?? {}),
      legacyRaw: raw,
      v3Raw: storage.getItem(V3_SESSION_KEY),
    };
  }
  function resetMission(missionId: string): Promise<ResetResult> {
    const run = (): ResetResult => {
      let current = load();
      if (!current.state && current.v3Raw !== null) {
        const loose = parse(current.v3Raw);
        if (loose && loose.version === 3) {
          delete loose.committedProposal;
          delete loose.evidence;
          loose.receipts = [];
          loose.activeView = 'saved';
          const recovered = parseV3(loose);
          if (recovered) current = { ...current, state: recovered };
        }
      }
      if (!current.state) {
        // A newer corrupt v3 record must remain untouched. The caller can
        // report the boundary instead of silently replacing user state.
        return { ok: false, reason: current.v3Raw !== null ? 'corrupt_state' : 'missing_state' };
      }
      let next: PersistedSession;
      try {
        const saved = Array.isArray(current.state.products)
          ? current.state.products.slice(0, 12)
          : [];
        next = {
          version: 3,
          missionId,
          brief: createBriefStateV3(missionId),
          products: saved,
          selectionRecords: [],
          compareIds: [],
          activeView: 'discover',
          receipts: [],
          committedProposal: null,
          evidence: [],
        };
        next = { ...next, brief: briefStateV3Schema.parse(next.brief) };
        if (next.missionId !== next.brief.missionId) throw new Error('mission_mismatch');
        if (!validateConciergeSession(next)) throw new Error('invalid_session');
      } catch {
        return { ok: false, reason: 'invalid_mutation' };
      }
      const serialized = JSON.stringify(next);
      if (current.v3Raw === serialized) return { ok: true, state: next };
      try {
        writeSession(current, serialized);
        return { ok: true, state: next };
      } catch {
        return { ok: false, reason: 'write_failed' };
      }
    };
    const result = transactionQueue.catch(() => undefined).then(run);
    transactionQueue = result.then(() => undefined);
    return result;
  }
  function commitAppliedMutation(
    mutator: (state: PersistedSession) => Promise<AppliedMutation> | AppliedMutation,
  ) {
    const run = async () => {
      const current = load();
      if (!current.state) return { ok: false as const, reason: 'missing_state' as const };
      let outcome: AppliedMutation;
      try {
        outcome = await mutator(structuredClone(current.state));
      } catch {
        return { ok: false as const, reason: 'invalid_mutation' as const };
      }
      if (outcome.result.status !== 'applied')
        return { ok: false as const, reason: 'rejected' as const };
      let next: PersistedSession;
      try {
        next = {
          ...outcome.state,
          version: 3,
          brief: briefStateV3Schema.parse(outcome.state.brief),
        };
        if (next.missionId !== next.brief.missionId) throw new Error('mission_mismatch');
        if (!validateConciergeSession(next)) throw new Error('invalid_session');
      } catch {
        return { ok: false as const, reason: 'invalid_mutation' as const };
      }
      if (JSON.stringify(current.state) === JSON.stringify(next))
        return { ok: true as const, state: next };
      const serialized = JSON.stringify(next);
      if (current.v3Raw === serialized) return { ok: true as const, state: next };
      try {
        writeSession(current, serialized);
        return { ok: true as const, state: next };
      } catch {
        return { ok: false as const, reason: 'write_failed' as const };
      }
    };
    const result = transactionQueue.catch(() => undefined).then(run);
    transactionQueue = result.then(() => undefined);
    return result;
  }
  return { load, commitMutation, commitAppliedMutation, rollback, resetMission };
}
