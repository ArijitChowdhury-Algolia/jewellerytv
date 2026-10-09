import { z } from 'zod';
import {
  briefStateSchema,
  briefStateV3Schema,
  type BriefFactV3Input,
  type BriefState,
  type BriefStateV3,
} from '../../briefSchema.js';
import { applyBriefOperationsV3, migrateBriefStateV2ToV3 } from '../../briefState.js';
import type { CatalogVocabulary } from '../vocabularyContract.js';
import {
  SUPPORTED_FACET_ATTRIBUTES,
  MATERIAL_COLOR_EXCLUSION_ATTRIBUTE,
  WATCH_BAND_MATERIAL_FAMILIES,
} from '../catalogueFactContract.js';

const factId = z.string().min(1).max(120);
const sourceId = z.string().min(1).max(150);
const textValue = z.object({ kind: z.literal('text'), text: z.string().min(1).max(500) }).strict();
const moneyValue = z
  .object({
    kind: z.literal('money'),
    cents: z.number().int().min(0).max(100000000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    operator: z.enum(['lt', 'lte', 'gt', 'gte', 'around']),
    basis: z.enum(['total', 'per_item', 'unresolved']),
  })
  .strict();
const facetValue = z
  .object({
    kind: z.literal('facet'),
    attribute: z.string().min(1).max(160),
    values: z.array(z.string().min(1).max(160)).min(1).max(20),
    operator: z.enum(['any', 'all', 'none']),
  })
  .strict();
const measurementValue = z
  .object({
    kind: z.literal('measurement'),
    value: z.number().finite().min(0).max(1000000),
    unit: z.enum(['mm', 'cm', 'in', 'ring_us', 'ring_uk', 'unknown']),
    component: z.string().max(120).nullable(),
  })
  .strict();
const productRefValue = z
  .object({
    kind: z.literal('product_ref'),
    objectID: z.string().min(1).max(150),
    sourceIndex: z.literal('prod_catalog'),
    relationship: z.enum([
      'liked',
      'rejected',
      'saved',
      'compared',
      'accepted',
      'owned',
      'reference',
    ]),
  })
  .strict();
const materialAlternativesValue = z
  .object({
    kind: z.literal('material_alternatives'),
    alternatives: z
      .array(
        z
          .object({
            // Free strings here; live-vocabulary validation happens in
            // toBriefFact so the accepted values follow the index, not code.
            type: z.string().max(160).nullable(),
            color: z.string().max(160).nullable(),
            purity: z.string().max(160).nullable(),
            plating: z
              .object({
                presence: z.enum(['required', 'forbidden']),
                purity: z.string().min(1).max(160).nullable(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
const watchBandFamilyValue = z
  .object({ kind: z.literal('watch_band_family'), family: z.enum(WATCH_BAND_MATERIAL_FAMILIES) })
  .strict();
const inputValue = z.union([
  textValue,
  moneyValue,
  facetValue,
  measurementValue,
  productRefValue,
  materialAlternativesValue,
  watchBandFamilyValue,
]);
const inputFact = z
  .object({
    id: factId,
    field: z.enum([
      'recipient',
      'occasion',
      'product_type',
      'design',
      'material',
      'gemstone',
      'watch_dial_color',
      'watch_band_type',
      'watch_band_material',
      'condition',
      'exclusion',
      'wearability',
      'budget',
      'fit',
      'item_reference',
      'education_depth',
      'selection',
      'other',
    ]),
    value: inputValue,
    scope: z
      .object({
        kind: z.enum(['mission', 'recipient', 'item', 'component']),
        key: z.string().max(120).nullable(),
      })
      .strict(),
    strength: z.enum(['requirement', 'preference', 'context']),
    certainty: z.enum(['explicit', 'tentative']),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.scope.kind === 'mission' && f.scope.key !== null)
      ctx.addIssue({ code: 'custom', message: 'Mission scope key must be null' });
  });
const inputOperation = z
  .object({
    action: z.enum(['add', 'replace', 'retract']),
    factIds: z.array(factId).max(24),
    fact: inputFact.nullable(),
    sourceQuote: z.string().min(1).max(2000),
  })
  .strict()
  .superRefine((o, ctx) => {
    if ((o.action === 'add' || o.action === 'replace') && !o.fact)
      ctx.addIssue({ code: 'custom', message: 'Add and replace require fact' });
    if (o.action === 'retract' && o.fact !== null)
      ctx.addIssue({ code: 'custom', message: 'Retract requires null fact' });
    if (o.action === 'add' && o.factIds.length !== 0)
      ctx.addIssue({ code: 'custom', message: 'Add requires empty factIds' });
    if ((o.action === 'replace' || o.action === 'retract') && o.factIds.length === 0)
      ctx.addIssue({ code: 'custom', message: 'Replace and retract require factIds' });
  });
export const updateShoppingStateInputSchema = z
  .object({
    missionId: z.string().min(1).max(120),
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    operationId: z.string().min(1).max(120),
    sourceMessageId: sourceId,
    operations: z.array(inputOperation).max(12),
  })
  .strict();
export type UpdateShoppingStateInput = z.infer<typeof updateShoppingStateInputSchema>;

export type ShopperMessage = { id: string; text: string };
export type ShoppingState = {
  brief: BriefState | BriefStateV3;
  receipts: readonly OperationReceipt[];
};
export type OperationReceipt = {
  operationId: string;
  payloadDigest: string;
  result: UpdateShoppingStateResult;
};
export type UpdateShoppingStateResult = {
  status: 'applied' | 'replayed' | 'stale_revision' | 'operation_conflict' | 'invalid_input';
  missionId: string;
  previousRevision: number;
  revision: number;
  operationId: string;
  appliedFactIds: string[];
  retractedFactIds: string[];
  currentStateDigest: string;
  failure: null | { code: string; message: string; currentRevision: number };
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
async function digest(value: unknown): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical(value)),
  );
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const canonicalSha256 = digest;
async function failure(
  input: Partial<UpdateShoppingStateInput>,
  brief: BriefState | BriefStateV3,
  status: UpdateShoppingStateResult['status'],
  code: string,
  message: string,
): Promise<UpdateShoppingStateResult> {
  return {
    status,
    missionId: input.missionId ?? brief.missionId,
    previousRevision: brief.revision,
    revision: brief.revision,
    operationId: input.operationId ?? '',
    appliedFactIds: [],
    retractedFactIds: [],
    currentStateDigest: await digest(brief),
    failure: { code, message, currentRevision: brief.revision },
  };
}
function toBriefFact(
  f: NonNullable<UpdateShoppingStateInput['operations'][number]['fact']>,
  sourceMessageId: string,
  quote: string,
  vocabulary: CatalogVocabulary | undefined,
): BriefFactV3Input {
  /** Live-vocabulary value gate. The index is the only source of truth for
   * which values exist; a fact the writer cannot verify against the live
   * vocabulary is refused with a distinct, agent-readable code. */
  const liveValues = (attribute: string): string[] => {
    if (!vocabulary) throw new Error(`VOCABULARY_UNAVAILABLE:${f.id}:${f.field}`);
    return vocabulary.availableValues(attribute);
  };
  const requireLiveValue = (attribute: string, value: string) => {
    if (!liveValues(attribute).includes(value))
      throw new Error(`VALUE_NOT_IN_LIVE_VOCABULARY:${f.id}:${f.field}:${attribute}:${value}`);
  };
  if (f.field === 'material' && f.value.kind === 'facet')
    throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
  if (f.field === 'product_type' && f.value.kind === 'text')
    throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
  if (f.field === 'exclusion' && f.value.kind === 'text' && f.strength === 'requirement')
    throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
  if (f.field !== 'material' && f.value.kind === 'material_alternatives')
    throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
  if (f.field !== 'watch_band_material' && f.value.kind === 'watch_band_family')
    throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
  if (f.field === 'watch_band_material' && f.value.kind !== 'watch_band_family')
    throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
  if (f.value.kind === 'material_alternatives') {
    for (const alternative of f.value.alternatives) {
      if (alternative.type !== null) requireLiveValue('Catalog_MaterialInformation.MaterialType', alternative.type);
      if (alternative.color !== null) requireLiveValue('Catalog_MaterialInformation.MaterialColor', alternative.color);
      if (alternative.purity !== null) requireLiveValue('Catalog_MaterialInformation.MaterialPurity', alternative.purity);
    }
  }
  if (f.value.kind === 'facet') {
    const facet = f.value;
    const expected =
      f.field === 'product_type'
        ? SUPPORTED_FACET_ATTRIBUTES.product_type
        : f.field === 'gemstone'
          ? SUPPORTED_FACET_ATTRIBUTES.gemstone
          : f.field === 'watch_dial_color'
            ? SUPPORTED_FACET_ATTRIBUTES.watch_dial_color
            : f.field === 'watch_band_type'
              ? SUPPORTED_FACET_ATTRIBUTES.watch_band_type
              : f.field === 'exclusion' && facet.attribute === 'Catalog_ProductType'
                ? 'Catalog_ProductType'
                : f.field === 'exclusion' && facet.attribute === 'Catalog_Motif'
                  ? 'Catalog_Motif'
                  : f.field === 'exclusion' &&
                      facet.attribute === MATERIAL_COLOR_EXCLUSION_ATTRIBUTE
                    ? MATERIAL_COLOR_EXCLUSION_ATTRIBUTE
                    : undefined;
    if (!expected || facet.attribute !== expected)
      throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
    if (
      (f.field !== 'watch_dial_color' &&
        f.field !== 'watch_band_type' &&
        f.field !== 'gemstone' &&
        f.field !== 'product_type' &&
        f.field !== 'exclusion') ||
      (f.field === 'watch_dial_color' && facet.operator !== 'any') ||
      (f.field === 'watch_band_type' && facet.operator !== 'any')
    )
      throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
    if (
      f.field === 'product_type' &&
      (facet.operator !== 'any' || facet.values.some((value) => !liveValues('Catalog_ProductType').includes(value)))
    )
      throw new Error(
        facet.values.some((value) => !liveValues('Catalog_ProductType').includes(value))
          ? `VALUE_NOT_IN_LIVE_VOCABULARY:${f.id}:${f.field}:Catalog_ProductType:${facet.values.find((value) => !liveValues('Catalog_ProductType').includes(value))}`
          : `UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`,
      );
    if (f.field === 'exclusion') {
      if (facet.operator !== 'none') throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
      if (facet.attribute === 'Catalog_ProductType') {
        facet.values.forEach((value) => requireLiveValue('Catalog_ProductType', value));
      } else if (facet.attribute === 'Catalog_Motif') {
        // Catalog_Motif is not exposed as a scannable facet; the single verified
        // exclusion value remains a literal naming-map entry, not a frozen copy.
        if (facet.values.some((value) => value !== 'Heart'))
          throw new Error(`UNSUPPORTED_FACT_ENCODING:${f.id}:${f.field}`);
      } else if (facet.attribute === MATERIAL_COLOR_EXCLUSION_ATTRIBUTE) {
        facet.values.forEach((value) =>
          requireLiveValue(MATERIAL_COLOR_EXCLUSION_ATTRIBUTE, value),
        );
      }
    }
    if (f.field !== 'exclusion') {
      if (f.field === 'gemstone' || f.field === 'watch_dial_color' || f.field === 'watch_band_type')
        facet.values.forEach((value) => requireLiveValue(facet.attribute, value));
    }
  }
  if (f.scope.kind !== 'mission' && !f.scope.key) throw new Error('unsupported_scope_key');
  const value: BriefFactV3Input['value'] =
    f.value.kind === 'money' && f.value.basis === 'per_item'
      ? { ...f.value, basis: 'per-item' as const }
      : (f.value as BriefFactV3Input['value']);
  return {
    id: f.id,
    field: f.field,
    value,
    scope: f.scope,
    strength: f.strength,
    certainty: f.certainty,
    origin: 'spoken',
    evidence: {
      messageId: sourceMessageId,
      quote,
      explicit: f.certainty === 'explicit',
      verified: false,
      sourceValidation: 'exact_user_message_substring',
    },
  };
}

export async function updateShoppingState(
  state: ShoppingState,
  rawInput: unknown,
  currentMessage: ShopperMessage,
  vocabulary?: CatalogVocabulary,
): Promise<{ state: ShoppingState; result: UpdateShoppingStateResult }> {
  const brief: BriefStateV3 =
    state.brief.version === 2
      ? migrateBriefStateV2ToV3(briefStateSchema.parse(state.brief))
      : briefStateV3Schema.parse(state.brief);
  const parsed = updateShoppingStateInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return {
      state,
      result: await failure(
        {},
        state.brief,
        'invalid_input',
        'schema_invalid',
        'Input failed strict callback validation',
      ),
    };
  const input = parsed.data;
  if (input.operations.length === 0)
    return {
      state,
      result: await failure(
        input,
        state.brief,
        'invalid_input',
        'NO_OPERATIONS',
        'No operations supplied',
      ),
    };
  const existing = state.receipts.find((r) => r.operationId === input.operationId);
  const payloadDigest = await digest(input);
  if (existing)
    return existing.payloadDigest === payloadDigest
      ? { state, result: { ...existing.result, status: 'replayed' } }
      : {
          state,
          result: await failure(
            input,
            state.brief,
            'operation_conflict',
            'operation_id_reused',
            'operationId was previously used with a different payload',
          ),
        };
  if (input.missionId !== brief.missionId)
    return {
      state,
      result: await failure(
        input,
        state.brief,
        'invalid_input',
        'mission_mismatch',
        'missionId does not match current brief',
      ),
    };
  if (input.expectedRevision !== brief.revision)
    return {
      state,
      result: await failure(
        input,
        state.brief,
        'stale_revision',
        'revision_mismatch',
        'expectedRevision does not match current brief',
      ),
    };
  if (input.sourceMessageId !== currentMessage.id)
    return {
      state,
      result: await failure(
        input,
        state.brief,
        'invalid_input',
        'message_mismatch',
        'sourceMessageId is not the current shopper message',
      ),
    };
  if (input.operations.some((o) => !currentMessage.text.includes(o.sourceQuote)))
    return {
      state,
      result: await failure(
        input,
        state.brief,
        'invalid_input',
        'quote_mismatch',
        'sourceQuote is not an exact substring of the current shopper message',
      ),
    };
  try {
    const operations = input.operations.map((o) =>
      o.action === 'retract'
        ? { type: 'retract' as const, factIds: o.factIds }
        : o.action === 'add'
          ? {
              type: 'add' as const,
              fact: toBriefFact(o.fact!, input.sourceMessageId, o.sourceQuote, vocabulary),
            }
          : {
              type: 'replace' as const,
              factIds: o.factIds,
              fact: toBriefFact(o.fact!, input.sourceMessageId, o.sourceQuote, vocabulary),
            },
    );
    if (
      input.operations.some((o) => (o.action === 'add' || o.action === 'replace') && !o.fact) ||
      input.operations.some((o) => o.action === 'retract' && o.fact !== null)
    )
      throw new Error('operation_shape');
    const next = applyBriefOperationsV3(brief, {
      missionId: input.missionId,
      expectedRevision: input.expectedRevision,
      turnId: input.operationId,
      operations,
    });
    const appliedFactIds = input.operations.flatMap((o) =>
      o.action === 'add' || o.action === 'replace' ? [o.fact!.id] : [],
    );
    const retractedFactIds = input.operations.flatMap((o) =>
      o.action === 'retract' || o.action === 'replace' ? o.factIds : [],
    );
    const result: UpdateShoppingStateResult = {
      status: 'applied',
      missionId: input.missionId,
      previousRevision: brief.revision,
      revision: next.revision,
      operationId: input.operationId,
      appliedFactIds,
      retractedFactIds,
      currentStateDigest: await digest(next),
      failure: null,
    };
    return {
      state: {
        brief: next,
        receipts: [
          ...state.receipts,
          { operationId: input.operationId, payloadDigest, result },
        ].slice(-200),
      },
      result,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'operation_rejected';
    const unsupported = detail.startsWith('UNSUPPORTED_FACT_ENCODING');
    const notLive = detail.startsWith('VALUE_NOT_IN_LIVE_VOCABULARY');
    const noVocabulary = detail.startsWith('VOCABULARY_UNAVAILABLE');
    return {
      state,
      result: await failure(
        input,
        state.brief,
        'invalid_input',
        notLive
          ? 'VALUE_NOT_IN_LIVE_VOCABULARY'
          : noVocabulary
            ? 'VOCABULARY_UNAVAILABLE'
            : unsupported
              ? 'UNSUPPORTED_FACT_ENCODING'
              : 'operation_rejected',
        detail,
      ),
    };
  }
}

export const applyShoppingStateUpdate = updateShoppingState;
