import { z } from 'zod';
import { BRIEF_FIELDS } from './shopping.js';
import { MONEY_OPERATORS, moneyOperatorLabel } from './moneyBounds.js';
const id = z.string().min(1).max(300);
export const briefValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(500) }).strict(),
  z
    .object({
      kind: z.literal('money'),
      cents: z.number().int().nonnegative().max(100000000),
      currency: z.string().regex(/^[A-Z]{3}$/),
      operator: z.enum(MONEY_OPERATORS),
      basis: z.enum(['total', 'per-item', 'unresolved']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('facet'),
      attribute: z.string().min(1).max(120),
      values: z.array(z.string().min(1).max(150)).min(1).max(20),
      operator: z.enum(['any', 'none']),
    })
    .strict(),
]);
export const briefEvidenceSchema = z
  .object({
    messageId: id,
    quote: z.string().min(1).max(2000),
    explicit: z.boolean(),
    verified: z.boolean(),
    sourceValidation: z.literal('exact_user_message_substring').optional(),
  })
  .strict();
const factShape = {
  id,
  field: z.enum(BRIEF_FIELDS),
  value: briefValueSchema,
  scope: z
    .object({ kind: z.enum(['mission', 'item', 'recipient']), key: id.optional() })
    .strict()
    .refine((s) => s.kind === 'mission' || !!s.key, 'Scoped facts need a key'),
  strength: z.enum(['requirement', 'preference']),
  origin: z.enum(['spoken', 'ui']),
  evidence: briefEvidenceSchema,
};
export const briefFactInputSchema = z
  .object({ ...factShape, status: z.enum(['active', 'tentative']) })
  .strict();
export const briefFactSchema = z
  .object({
    ...factShape,
    status: z.enum(['active', 'tentative', 'retracted', 'superseded']),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().max(100),
  })
  .strict()
  .transform((f) =>
    f.status === 'active' && f.value.kind === 'money' && f.value.basis === 'unresolved'
      ? { ...f, status: 'tentative' as const }
      : f,
  );
export const briefOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reset-brief'), evidence: briefEvidenceSchema.optional() }).strict(),
  z.object({ type: z.literal('add'), fact: briefFactInputSchema }).strict(),
  z
    .object({
      type: z.literal('replace'),
      factIds: z.array(id).min(1).max(40),
      fact: briefFactInputSchema,
    })
    .strict(),
  ...(['retract', 'confirm', 'mark-tentative'] as const).map((type) =>
    z.object({ type: z.literal(type), factIds: z.array(id).min(1).max(40) }).strict(),
  ),
]);
export const briefPatchSchema = z
  .object({
    missionId: id,
    expectedRevision: z.number().int().nonnegative(),
    turnId: id,
    operations: z.array(briefOperationSchema).max(40),
  })
  .strict();
const tombstoneSchema = z
  .object({
    factId: id,
    messageId: id,
    quote: z.string().max(2000),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const eventSchema = z
  .object({
    resetEvidence: briefEvidenceSchema.optional(),
    revision: z.number().int().nonnegative(),
    turnId: id,
    beforeFacts: z.array(briefFactSchema).max(200),
    beforeTombstones: z.array(tombstoneSchema).max(200),
  })
  .strict();
export const briefStateSchema = z
  .object({
    version: z.literal(2),
    missionId: id,
    revision: z.number().int().nonnegative(),
    facts: z.array(briefFactSchema).max(200),
    processedTurns: z.array(id).max(200),
    tombstones: z.array(tombstoneSchema).max(200),
    events: z.array(eventSchema).max(20),
  })
  .strict()
  .refine((s) => new Set(s.facts.map((f) => f.id)).size === s.facts.length, 'Duplicate fact IDs');
// V2 remains the reader and authority for existing persisted records. V3 is the
// lossless callback model; it deliberately has its own schemas so old records
// cannot silently acquire new semantics.
const materialAlternativesValueSchema = z
  .object({
    kind: z.literal('material_alternatives'),
    alternatives: z
      .array(
        z
          .object({
            // Free strings: the persisted schema stays tolerant of any material
            // vocabulary the index may carry. Gate-keeping against the live
            // vocabulary happens once, in the writer (updateShoppingState),
            // which is the only path that creates these facts.
            type: z.string().max(160).nullable(),
            color: z.string().max(160).nullable(),
            purity: z.string().max(160).nullable(),
            plating: z
              .object({
                presence: z.enum(['required', 'forbidden']),
                purity: z.string().max(160).nullable(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const a of v.alternatives) {
      if (!a.type && !a.color && !a.purity && !a.plating)
        ctx.addIssue({
          code: 'custom',
          message: 'Alternative must constrain at least one property',
        });
      if (a.plating?.presence === 'forbidden' && a.plating.purity !== null)
        ctx.addIssue({ code: 'custom', message: 'Forbidden plating cannot specify purity' });
      const key = JSON.stringify(a);
      if (seen.has(key))
        ctx.addIssue({ code: 'custom', message: 'Duplicate material alternative' });
      seen.add(key);
    }
  });
const watchBandFamilyValueSchema = z
  .object({
    kind: z.literal('watch_band_family'),
    family: z.literal('metal'),
  })
  .strict();
const v3Field = z.enum([
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
  'style',
  'unknown',
  'other',
]);
export const briefV3ValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(500) }).strict(),
  z
    .object({
      kind: z.literal('money'),
      cents: z.number().int().nonnegative().max(100000000),
      currency: z.string().regex(/^[A-Z]{3}$/),
      operator: z.enum(['lt', 'lte', 'gt', 'gte', 'around']),
      basis: z.enum(['total', 'per-item', 'unresolved']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('facet'),
      attribute: z.string().min(1).max(160),
      values: z.array(z.string().min(1).max(160)).min(1).max(20),
      operator: z.enum(['any', 'all', 'none']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('measurement'),
      value: z.number().finite().min(0).max(1000000),
      unit: z.enum(['mm', 'cm', 'in', 'ring_us', 'ring_uk', 'unknown']),
      component: z.string().max(120).nullable(),
    })
    .strict(),
  z
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
    .strict(),
  materialAlternativesValueSchema,
  watchBandFamilyValueSchema,
]);
const v3Scope = z
  .object({
    kind: z.enum(['mission', 'recipient', 'item', 'component']),
    key: z.string().max(300).nullable(),
  })
  .strict()
  .refine((s) => s.kind === 'mission' || !!s.key, 'Scoped facts need a key');
const v3FactShape = {
  id,
  field: v3Field,
  value: briefV3ValueSchema,
  scope: v3Scope,
  strength: z.enum(['requirement', 'preference', 'context']),
  certainty: z.enum(['explicit', 'tentative']),
  origin: z.enum(['spoken', 'ui']),
  evidence: briefEvidenceSchema,
};
export const briefV3FactInputSchema = z.object(v3FactShape).strict();
export const briefV3FactSchema = z
  .object({
    ...v3FactShape,
    status: z.enum(['active', 'tentative', 'retracted', 'superseded']),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().max(100),
  })
  .strict()
  .transform((f) =>
    f.status === 'active' &&
    (f.certainty === 'tentative' || (f.value.kind === 'money' && f.value.basis === 'unresolved'))
      ? { ...f, status: 'tentative' as const }
      : f,
  );
const v3Tombstone = z
  .object({
    factId: id,
    messageId: id,
    quote: z.string().max(2000),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const v3Event = z
  .object({
    resetEvidence: briefEvidenceSchema.optional(),
    revision: z.number().int().nonnegative(),
    turnId: id,
    beforeFacts: z.array(briefV3FactSchema).max(200),
    beforeTombstones: z.array(v3Tombstone).max(200),
  })
  .strict();
export const briefStateV3Schema = z
  .object({
    version: z.literal(3),
    missionId: id,
    revision: z.number().int().nonnegative(),
    facts: z.array(briefV3FactSchema).max(200),
    processedTurns: z.array(id).max(200),
    tombstones: z.array(v3Tombstone).max(200),
    events: z.array(v3Event).max(20),
  })
  .strict()
  .refine((s) => new Set(s.facts.map((f) => f.id)).size === s.facts.length, 'Duplicate fact IDs');
export type BriefFactInput = z.infer<typeof briefFactInputSchema>;
export type BriefFactV2 = z.infer<typeof briefFactSchema>;
export type BriefOperation = z.infer<typeof briefOperationSchema>;
export type BriefPatch = z.infer<typeof briefPatchSchema>;
export type BriefState = z.infer<typeof briefStateSchema>;
export type BriefFactV3Input = z.infer<typeof briefV3FactInputSchema>;
export type BriefFactV3 = z.infer<typeof briefV3FactSchema>;
export type BriefStateV3 = z.infer<typeof briefStateV3Schema>;
/** Legacy semantic verification and deterministic source correspondence are distinct. */
export function hasAcceptedSourceEvidence(evidence: z.infer<typeof briefEvidenceSchema>) {
  return evidence.verified || evidence.sourceValidation === 'exact_user_message_substring';
}
export function formatBriefValue(value: BriefFactV2['value']): string {
  if (value.kind === 'text') return value.text;
  if (value.kind === 'facet')
    return `${value.operator === 'none' ? 'No ' : ''}${value.values.join(' or ')}`;
  return `${moneyOperatorLabel(value.operator)} ${value.currency === 'USD' ? '$' : value.currency + ' '}${(value.cents / 100).toFixed(2)}${value.basis === 'total' ? ' total' : value.basis === 'per-item' ? ' per item' : ' (scope unclear)'}`;
}
export function formatBriefV3Value(value: BriefFactV3['value']): string {
  if (value.kind === 'text') return value.text;
  if (value.kind === 'facet')
    return `${value.operator === 'none' ? 'No ' : ''}${value.values.join(' or ')}`;
  if (value.kind === 'measurement') return `${value.value} ${value.unit}`;
  if (value.kind === 'product_ref') return `${value.relationship} ${value.objectID}`;
  if (value.kind === 'watch_band_family') return value.family;
  if (value.kind === 'material_alternatives')
    return value.alternatives
      .map((a) =>
        [
          a.type,
          a.color,
          a.purity,
          a.plating
            ? `${a.plating.presence} plating${a.plating.purity ? ` ${a.plating.purity}` : ''}`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
      )
      .join(' or ');
  return `${value.operator === 'around' ? 'Around' : moneyOperatorLabel(value.operator)} ${value.currency === 'USD' ? '$' : value.currency + ' '}${(value.cents / 100).toFixed(2)}${value.basis === 'total' ? ' total' : value.basis === 'per-item' ? ' per item' : ' (scope unclear)'}`;
}
