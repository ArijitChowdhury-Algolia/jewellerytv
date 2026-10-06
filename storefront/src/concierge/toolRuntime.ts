import { briefStateV3Schema, type BriefStateV3 } from '../../shared/briefSchema.js';
import { z } from 'zod';
import {
  retrieveEvidenceInputSchema,
  type RetrieveEvidenceInput,
} from '../../shared/concierge/retrieval/schema.js';
import type {
  EvidenceRecord,
  RetrieveEvidenceResult,
} from '../../shared/concierge/retrieval/types.js';
import {
  presentChoices,
  commitStagedChoices,
  presentChoicesSchema,
  type PresentationEvidence,
  type PresentationMoneyBound,
  type StagedPresentation,
  type PresentationTurnStatus,
} from '../../shared/concierge/presentation.js';
import { catalogueGroupBasisSchema } from '../../shared/concierge/presentation-contract.js';
import {
  updateShoppingState,
  type OperationReceipt,
  type ShopperMessage,
  type UpdateShoppingStateResult,
} from '../../shared/concierge/state/updateShoppingState.js';
import { createSessionPersistence, type StorageLike } from './sessionPersistence.js';
import type { createSessionStore } from './sessionStore.js';

type EvidenceRequest = { input: RetrieveEvidenceInput; brief: BriefStateV3 };
type EvidenceResponse = RetrieveEvidenceResult & { evidenceBatchRevision: number };
type RuntimeOptions = {
  storage: StorageLike;
  initialMissionId: string;
  getCurrentShopperMessage: () => ShopperMessage | null;
  fetchEvidence: (body: EvidenceRequest, signal?: AbortSignal) => Promise<RetrieveEvidenceResult>;
  sessionStore?: ReturnType<typeof createSessionStore>;
};

function storedReceipts(value: unknown): OperationReceipt[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.operationId !== 'string' ||
        typeof entry.payloadDigest !== 'string' ||
        !entry.result ||
        typeof entry.result !== 'object',
    )
  )
    throw new Error('Invalid stored operation receipts');
  return value as OperationReceipt[];
}

function budgetBounds(brief: BriefStateV3): {
  verified: boolean;
  bounds: PresentationMoneyBound[];
} {
  const facts = brief.facts.filter(
    (fact) =>
      fact.status === 'active' && fact.field === 'budget' && fact.strength === 'requirement',
  );
  if (!facts.length) return { verified: false, bounds: [] };
  const bounds: PresentationMoneyBound[] = [];
  for (const fact of facts) {
    if (
      fact.value.kind !== 'money' ||
      fact.scope.kind !== 'mission' ||
      fact.value.basis === 'unresolved' ||
      fact.certainty !== 'explicit'
    )
      return { verified: false, bounds: [] };
    bounds.push({
      cents: fact.value.cents,
      currency: fact.value.currency,
      operator: fact.value.operator,
      basis: fact.value.basis,
    });
  }
  return { verified: true, bounds };
}

function explicitTrue(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.some((field) => {
    const value = record[field];
    if (value === true) return true;
    if (typeof value !== 'string') return false;
    return ['yes', 'true', 'included', 'pair', 'earring pair', 'chain included'].includes(
      value.trim().toLocaleLowerCase(),
    );
  });
}

function explicitPair(record: Record<string, unknown>): boolean {
  if (explicitTrue(record, ['Catalog_PairIncluded', 'Catalog_SoldAsPair', 'Catalog_Pair']))
    return true;
  if (
    ['Catalog_PairCount', 'Catalog_PieceCount', 'Catalog_Quantity'].some(
      (field) => record[field] === 2,
    )
  )
    return true;
  return ['Catalog_SaleUnit', 'Catalog_SellingUnit', 'Catalog_UnitOfSale'].some((field) => {
    const value = record[field];
    return (
      typeof value === 'string' &&
      ['pair', 'earring pair'].includes(value.trim().toLocaleLowerCase())
    );
  });
}

function contentsVerifiedFromRecord(record: Record<string, unknown>): boolean {
  const type = record.Catalog_ProductType;
  if (typeof type !== 'string' || !type.trim()) return false;
  const normalizedType = type.trim();
  if (['Ring', 'Necklace', 'Bracelet'].includes(normalizedType)) {
    const title = record.Catalog_TitleDescription;
    const description = record.Catalog_LongDescription;
    if (
      typeof record.objectID !== 'string' ||
      typeof record.Pricing_ActivePrice !== 'number' ||
      !Number.isFinite(record.Pricing_ActivePrice) ||
      typeof title !== 'string' ||
      !new RegExp(`\\b${normalizedType}\\b`, 'i').test(title)
    )
      return false;
    const wording = `${title} ${typeof description === 'string' ? description : ''}`;
    if (/\b(?:set of|matching set|bundle|pair of|multi[- ]piece)\b/i.test(wording)) return false;
    if (
      /\b(?:necklace|bracelet|ring)\s*(?:and|&)\s*(?:earrings?|bracelets?|rings?)\b/i.test(wording)
    )
      return false;
    return true;
  }
  if (normalizedType === 'Earrings') return explicitPair(record);
  if (normalizedType === 'Pendant')
    return explicitTrue(record, [
      'Catalog_ChainIncluded',
      'Catalog_IncludesChain',
      'ChainIncluded',
      'IncludesChain',
    ]);
  if (explicitTrue(record, ['Catalog_ContentsVerified', 'Catalog_SetContentsVerified']))
    return true;
  return false;
}

/** Deterministic callback state only. The Concierge owns language and curation. */
export function createConciergeToolRuntime(options: RuntimeOptions) {
  const persistence =
    options.sessionStore ?? createSessionPersistence(options.storage, options.initialMissionId);
  let turnId = '';
  let batchRevision = 0;
  let ledger: PresentationEvidence[] = [];
  let staged: StagedPresentation | null = null;
  let published: StagedPresentation | null = null;
  let publishedRecords: EvidenceRecord[] = [];
  let generation = 0;
  let presentationAttempted = false;
  const semanticUpdates = new Map<
    string,
    {
      payload: string;
      result: UpdateShoppingStateResult | { status: string; failure?: { code: string } };
    }
  >();
  let activeShopperMessageId = '';
  const restored = options.sessionStore?.getSnapshot();
  if (restored?.committedProposal)
    published = restored.committedProposal as unknown as StagedPresentation;
  if (restored?.selectionRecords)
    publishedRecords = restored.selectionRecords
      .filter((record) => record.binding === 'evidence_bound')
      .map(
        (record) =>
          ({
            source: 'prod_catalog',
            objectID: record.objectID,
            contentHash: record.contentHash,
            evidenceRef: record.evidenceRef,
            retrievedAt: record.observedAt ?? '',
            record: record.raw,
          }) as EvidenceRecord,
      );

  const current = () => persistence.load().state;
  const clearPending = () => {
    ledger = [];
    staged = null;
    batchRevision++;
  };
  function beginTurn(nextTurnId: string, shopperMessageId: string) {
    turnId = nextTurnId;
    activeShopperMessageId = shopperMessageId;
    presentationAttempted = false;
    semanticUpdates.clear();
    clearPending();
    generation++;
  }
  const getActiveTurnToken = () => (turnId && activeShopperMessageId ? generation : null);
  function notePresentationAttempt(expectedGeneration?: number) {
    if (!turnId || !activeShopperMessageId) return false;
    if (expectedGeneration !== undefined && expectedGeneration !== generation) return false;
    presentationAttempted = true;
    return true;
  }
  function endTurn(finishedTurnId: string) {
    if (finishedTurnId !== turnId) return false;
    generation++;
    turnId = '';
    activeShopperMessageId = '';
    clearPending();
    semanticUpdates.clear();
    return true;
  }
  function invalidateTurn() {
    generation++;
    turnId = '';
    activeShopperMessageId = '';
    clearPending();
    semanticUpdates.clear();
  }
  const semanticLine = z
    .object({
      evidenceRef: z.string().min(1),
      quantity: z.number().int().min(1).max(20),
      componentSlot: z.string().min(1),
      explanation: z.string().min(1).max(500),
    })
    .strict();
  const semanticBody = z.union([
    z
      .object({
        kind: z.literal('product_groups'),
        groups: z.array(
          z
            .object({ basis: catalogueGroupBasisSchema, items: z.array(semanticLine).min(1) })
            .strict(),
        ),
        alternatives: z.null(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('complete_looks'),
        groups: z.null(),
        alternatives: z.array(
          z.object({ title: z.string().min(1), lines: z.array(semanticLine).min(1) }).strict(),
        ),
      })
      .strict(),
  ]);
  async function presentSemantic(
    raw: { body: unknown },
    toolCallId: string,
    expectedGeneration?: number,
  ) {
    if (expectedGeneration !== undefined && expectedGeneration !== generation)
      return { status: 'stale_state', reasons: ['active_turn_changed'] };
    const parsed = semanticBody.safeParse(raw.body);
    const session = current();
    if (!session || !turnId || !activeShopperMessageId)
      return { status: 'invalid_input', reasons: ['semantic_input_invalid'] };
    presentationAttempted = true;
    if (!parsed.success) return { status: 'invalid_input', reasons: ['semantic_input_invalid'] };
    const resolve = (line: z.infer<typeof semanticLine>) => {
      const found = ledger.find(
        (entry) =>
          entry.evidenceRef === line.evidenceRef &&
          entry.source === 'prod_catalog' &&
          entry.turnId === turnId &&
          entry.missionId === session.missionId &&
          entry.stateRevision === session.brief.revision &&
          entry.evidenceBatchRevision === batchRevision,
      );
      if (!found) throw new Error('unknown_or_stale_evidence');
      return { ...line, objectID: found.objectID, contentHash: found.contentHash };
    };
    try {
      const body =
        parsed.data.kind === 'product_groups'
          ? {
              ...parsed.data,
              groups: parsed.data.groups.map((g) => ({ ...g, items: g.items.map(resolve) })),
            }
          : {
              ...parsed.data,
              alternatives: parsed.data.alternatives.map((g) => ({
                ...g,
                lines: g.lines.map(resolve),
              })),
            };
      return await present({
        missionId: session.missionId,
        expectedStateRevision: session.brief.revision,
        expectedEvidenceBatchRevision: batchRevision,
        turnId,
        proposalId: toolCallId,
        body,
      });
    } catch {
      return { status: 'invalid_evidence', reasons: ['unknown_or_stale_evidence'] };
    }
  }
  async function retrieveSemantic(
    raw: {
      source: 'prod_catalog' | 'blog';
      query: string;
      count: number;
      exactObjectIDs?: string[] | null;
      target: null | { kind: 'item'; itemKey: string; productType: string };
    },
    _toolCallId: string,
    signal?: AbortSignal,
    expectedGeneration?: number,
  ) {
    if (expectedGeneration !== undefined && expectedGeneration !== generation)
      return { status: 'stale_revision', evidenceBatchRevision: batchRevision };
    const session = current();
    if (!session || !turnId || !activeShopperMessageId)
      return { status: 'invalid_input', evidenceBatchRevision: batchRevision };
    if (signal?.aborted) return { status: 'aborted', evidenceBatchRevision: batchRevision };
    if (raw.source === 'blog' && (raw.target !== null || raw.exactObjectIDs))
      return { status: 'invalid_input', evidenceBatchRevision: batchRevision };
    return retrieve(
      {
        source: raw.source,
        query: raw.query,
        count: raw.count,
        exactObjectIDs: raw.exactObjectIDs ?? null,
        target: raw.target,
        missionId: session.missionId,
        expectedRevision: session.brief.revision,
        turnId,
      },
      signal,
    );
  }
  async function updateSemantic(
    raw: { operations: unknown[] },
    toolCallId: string,
    signal?: AbortSignal,
    expectedGeneration?: number,
  ) {
    if (expectedGeneration !== undefined && expectedGeneration !== generation)
      return { status: 'stale_revision', failure: { code: 'ACTIVE_TURN_CHANGED' } };
    const session = current(),
      message = options.getCurrentShopperMessage();
    if (!session || !turnId || !message || message.id !== activeShopperMessageId || signal?.aborted)
      return {
        status: 'invalid_input',
        failure: { code: signal?.aborted ? 'TOOL_ABORTED' : 'STALE_ACTIVE_TURN' },
      };
    if (
      !raw ||
      !Array.isArray(raw.operations) ||
      raw.operations.length < 1 ||
      raw.operations.length > 12 ||
      raw.operations.some(
        (operation) => !operation || typeof operation !== 'object' || Array.isArray(operation),
      )
    )
      return { status: 'invalid_input', failure: { code: 'NO_OPERATIONS' } };
    if (
      message.text.length > 2000 &&
      raw.operations.some(
        (operation) => (operation as Record<string, unknown>).sourceQuote == null,
      )
    )
      return { status: 'invalid_input', failure: { code: 'SOURCE_QUOTE_REQUIRED' } };
    const payload = JSON.stringify(raw),
      cached = semanticUpdates.get(toolCallId);
    if (cached) {
      if (cached.payload !== payload)
        return { status: 'operation_conflict', failure: { code: 'OPERATION_ID_REUSED' } };
      return cached.result;
    }
    const operations = raw.operations.map((operation, index) => {
      const op = structuredClone(operation) as Record<string, unknown>;
      const fact =
        op.fact && typeof op.fact === 'object'
          ? { ...(op.fact as Record<string, unknown>), id: `${toolCallId}-fact-${index}` }
          : op.fact;
      return { ...op, sourceQuote: op.sourceQuote ?? message.text, fact };
    });
    const result = await update(
      {
        missionId: session.missionId,
        expectedRevision: session.brief.revision,
        operationId: toolCallId,
        sourceMessageId: message.id,
        operations,
      },
      signal,
    );
    if (result.status === 'aborted' || result.status === 'storage_failure') return result;
    semanticUpdates.set(toolCallId, { payload, result });
    return result;
  }

  async function update(input: unknown, signal?: AbortSignal) {
    const requestGeneration = generation;
    if (signal?.aborted) return { status: 'aborted', failure: { code: 'TOOL_ABORTED' } };
    const message = options.getCurrentShopperMessage();
    if (!message) return { status: 'invalid_input', failure: { code: 'MISSING_SHOPPER_MESSAGE' } };
    const captured: { value: UpdateShoppingStateResult | null } = { value: null };
    let abortedDuringMutation = false;
    const persisted = await persistence.commitAppliedMutation(async (session) => {
      if (signal?.aborted || requestGeneration !== generation) {
        abortedDuringMutation = true;
        return { state: session, result: { status: 'aborted' } };
      }
      const result = await updateShoppingState(
        { brief: session.brief, receipts: storedReceipts(session.receipts) },
        input,
        message,
      );
      if (signal?.aborted || requestGeneration !== generation) {
        abortedDuringMutation = true;
        return { state: session, result: { status: 'aborted' } };
      }
      captured.value = result.result;
      return {
        state: {
          ...session,
          brief: result.state.brief.version === 3 ? result.state.brief : session.brief,
          receipts: [...result.state.receipts],
        },
        result: result.result,
      };
    });
    if (abortedDuringMutation) return { status: 'aborted', failure: { code: 'TOOL_ABORTED' } };
    if (!persisted.ok && persisted.reason !== 'rejected')
      return { status: 'storage_failure', failure: { code: persisted.reason } };
    if (captured.value?.status === 'applied') clearPending();
    return captured.value ?? { status: 'invalid_input', failure: { code: 'UPDATE_UNAVAILABLE' } };
  }

  async function retrieve(
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<EvidenceResponse | { status: string; evidenceBatchRevision: number }> {
    const requestGeneration = generation;
    const parsed = retrieveEvidenceInputSchema.safeParse(raw);
    if (!parsed.success) return { status: 'invalid_input', evidenceBatchRevision: batchRevision };
    const input = parsed.data;
    const before = current();
    if (!before) return { status: 'state_unavailable', evidenceBatchRevision: batchRevision };
    if (before.missionId !== input.missionId || before.brief.revision !== input.expectedRevision)
      return { status: 'stale_revision', evidenceBatchRevision: batchRevision };
    if (signal?.aborted || requestGeneration !== generation)
      return { status: 'aborted', evidenceBatchRevision: batchRevision };
    let result: RetrieveEvidenceResult;
    try {
      result = await options.fetchEvidence(
        { input, brief: briefStateV3Schema.parse(before.brief) },
        signal,
      );
    } catch {
      return {
        status: signal?.aborted ? 'aborted' : 'upstream_failure',
        evidenceBatchRevision: batchRevision,
      };
    }
    const after = current();
    if (signal?.aborted || requestGeneration !== generation)
      return { status: 'aborted', evidenceBatchRevision: batchRevision };
    if (
      !after ||
      after.missionId !== input.missionId ||
      after.brief.revision !== input.expectedRevision
    )
      return { status: 'stale_revision', evidenceBatchRevision: batchRevision };
    if (
      result.missionId !== input.missionId ||
      result.revision !== input.expectedRevision ||
      result.turnId !== input.turnId ||
      result.source !== input.source ||
      result.records.some((record) => record.source !== input.source)
    )
      return { status: 'invalid_evidence', evidenceBatchRevision: batchRevision };
    if (result.status === 'ok') {
      if (turnId !== input.turnId) {
        turnId = input.turnId;
        clearPending();
      }
      const existing = new Set(ledger.map((entry) => entry.evidenceRef));
      for (const record of result.records) {
        if (existing.has(record.evidenceRef)) continue;
        ledger.push({
          ...record,
          missionId: input.missionId,
          stateRevision: input.expectedRevision,
          evidenceBatchRevision: batchRevision,
          turnId: input.turnId,
          contentsVerified: contentsVerifiedFromRecord(record.record),
        });
        existing.add(record.evidenceRef);
      }
    }
    return { ...result, evidenceBatchRevision: batchRevision };
  }

  async function present(raw: unknown) {
    presentationAttempted = true;
    const parsed = presentChoicesSchema.safeParse(raw);
    if (!parsed.success) return { status: 'invalid_input', reasons: ['schema_invalid'] };
    const session = current();
    if (!session) return { status: 'state_unavailable', reasons: ['session_unavailable'] };
    const brief = briefStateV3Schema.parse(session.brief);
    const budget = budgetBounds(brief);
    const acceptedAnchorIds = brief.facts
      .filter(
        (fact) =>
          fact.status === 'active' &&
          fact.field === 'item_reference' &&
          fact.value.kind === 'product_ref' &&
          fact.value.relationship === 'accepted',
      )
      .map((fact) => (fact.value.kind === 'product_ref' ? fact.value.objectID : ''))
      .filter(Boolean);
    const result = presentChoices(parsed.data, {
      missionId: session.missionId as string,
      stateRevision: brief.revision,
      evidenceBatchRevision: batchRevision,
      turnId,
      evidence: ledger,
      bounds: budget.bounds,
      budgetContextVerified: budget.verified,
      acceptedAnchorIds,
      priorProposal: published,
    });
    if (result.status === 'staged') staged = result.proposal;
    return result;
  }

  function finishTurn(
    finishedTurnId: string,
    status: PresentationTurnStatus,
  ): StagedPresentation | null {
    if (!staged || finishedTurnId !== staged.turnId) return null;
    const session = current();
    const result = commitStagedChoices(
      staged,
      {
        missionId: String(session?.missionId ?? ''),
        stateRevision: session?.brief.revision ?? -1,
        evidenceBatchRevision: batchRevision,
        turnId: finishedTurnId,
        turnStatus: status,
      },
      published,
    );
    staged = null;
    if (result.status !== 'committed') return null;
    published = result.proposal;
    const refs = new Set(
      published.groups.flatMap((group) => group.lines.map((line) => line.evidenceRef)),
    );
    publishedRecords = ledger.filter((entry) => refs.has(entry.evidenceRef));
    return published;
  }
  async function finishTurnAndPersist(finishedTurnId: string, status: PresentationTurnStatus) {
    const previousPublished = published,
      previousRecords = [...publishedRecords];
    const proposal = finishTurn(finishedTurnId, status);
    if (!proposal || !options.sessionStore) return proposal;
    const session = options.sessionStore.getSnapshot();
    if (!session) return null;
    const refs = new Set(
      proposal.groups.flatMap((group) => group.lines.map((line) => line.evidenceRef)),
    );
    const records = publishedRecords.filter(
      (record) => record.source === 'prod_catalog' && refs.has(record.evidenceRef),
    );
    const result = await options.sessionStore.transact({
      expectedRevision: session.brief.revision,
      apply: (current) => {
        const products = current.products.map((product) => {
          const replacement = records.find((record) => record.objectID === product.objectID);
          return replacement
            ? {
                ...product,
                sourceIndex: 'prod_catalog' as const,
                contentHash: replacement.contentHash,
                evidenceRef: replacement.evidenceRef,
                binding: 'evidence_bound' as const,
                raw: replacement.record,
              }
            : product;
        });
        const selectionRecords = Array.from(
          new Map(
            [
              ...current.selectionRecords,
              ...records.map((record) => {
                const saved = products.find((product) => product.objectID === record.objectID);
                if (saved) return saved;
                const previous = current.selectionRecords.find(
                  (product) => product.objectID === record.objectID,
                );
                return {
                  sourceIndex: 'prod_catalog' as const,
                  objectID: record.objectID,
                  contentHash: record.contentHash,
                  evidenceRef: record.evidenceRef,
                  binding: 'evidence_bound' as const,
                  raw: record.record,
                  quantity: previous?.quantity ?? 1,
                  observedAt: previous?.observedAt ?? new Date().toISOString(),
                };
              }),
            ].map((value) => [value.objectID, value] as const),
          ).values(),
        ).slice(-12);
        return {
          ...current,
          committedProposal: proposal,
          activeView: proposal.kind === 'complete_looks' ? 'combination' : 'discover',
          products,
          selectionRecords,
          evidence: records.map((record) => ({
            evidenceRef: record.evidenceRef,
            sourceIndex: 'prod_catalog' as const,
            objectID: record.objectID,
            contentHash: record.contentHash,
          })),
        };
      },
    });
    if (!result.ok) {
      published = previousPublished;
      publishedRecords = previousRecords;
      return null;
    }
    return proposal;
  }

  async function resetMission(missionId: string) {
    const result = await persistence.resetMission(missionId);
    if (!result.ok) return result;
    generation++;
    turnId = '';
    activeShopperMessageId = '';
    semanticUpdates.clear();
    batchRevision = 0;
    ledger = [];
    staged = null;
    published = null;
    publishedRecords = [];
    presentationAttempted = false;
    return result;
  }

  return {
    update,
    retrieve,
    present,
    beginTurn,
    getActiveTurnToken,
    notePresentationAttempt,
    endTurn,
    invalidateTurn,
    presentSemantic,
    retrieveSemantic,
    updateSemantic,
    finishTurn,
    finishTurnAndPersist,
    resetMission,
    getPublished: () => published,
    getPublishedRecords: () => publishedRecords,
    hadPresentationAttempt: () => presentationAttempted,
    getSession: current,
  };
}
