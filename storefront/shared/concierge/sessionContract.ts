import { z } from 'zod';
import { briefStateV3Schema } from '../briefSchema.js';
const iso = z
  .union([z.string().date(), z.string().datetime({ offset: true })])
  .nullable();
const raw = z.record(z.string(), z.unknown());
const common = {
  sourceIndex: z.literal('prod_catalog'),
  objectID: z.string().min(1),
  raw: raw.refine((r) => typeof r.objectID === 'string'),
  quantity: z.number().int().min(1).max(10),
  observedAt: iso,
};
export const evidenceBoundProductSchema = z
  .object({
    ...common,
    binding: z.literal('evidence_bound'),
    contentHash: z.string().min(1),
    evidenceRef: z.string().min(1),
  })
  .strict()
  .refine((product) => product.raw.objectID === product.objectID, 'Raw product identity mismatch');
export const legacySavedProductSchema = z
  .object({
    ...common,
    binding: z.literal('legacy_unbound'),
    contentHash: z.null(),
    evidenceRef: z.null(),
  })
  .strict()
  .refine((product) => product.raw.objectID === product.objectID, 'Raw product identity mismatch');
export const savedProductSchema = z.discriminatedUnion('binding', [
  evidenceBoundProductSchema,
  legacySavedProductSchema,
]);
export type EvidenceBoundProduct = z.infer<typeof evidenceBoundProductSchema>;
export type LegacySavedProduct = z.infer<typeof legacySavedProductSchema>;
export type SourceBoundProduct = EvidenceBoundProduct | LegacySavedProduct;
const receipt = z
  .object({
    operationId: z.string().min(1),
    payloadDigest: z.string().min(1),
    result: z.object({ status: z.string() }).passthrough(),
  })
  .strict();
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const proposalLine = z
  .object({
    evidenceRef: z.string().min(1),
    objectID: z.string().min(1),
    contentHash: z.string().min(1),
    quantity: z.number().int().min(1).max(20),
    componentSlot: z.string().min(1),
    explanation: z.string().min(1),
    unitPriceCents: cents,
    lineSubtotalCents: cents,
  })
  .strict();
const proposal = z
  .object({
    missionId: z.string().min(1),
    stateRevision: z.number().int().nonnegative(),
    evidenceBatchRevision: z.number().int().nonnegative(),
    turnId: z.string().min(1),
    proposalId: z.string().min(1),
    kind: z.enum(['product_groups', 'complete_looks']),
    groups: z
      .array(
        z
          .object({
            title: z.string().min(1),
            lines: z.array(proposalLine).min(1).max(3),
            itemSubtotalCents: cents,
          })
          .strict(),
      )
      .min(1)
      .max(3),
    combinedItemSubtotalCents: cents,
    assessment: z
      .object({
        perItem: z.enum(['accepted', 'unresolved', 'conflict']),
        total: z.enum(['accepted', 'unresolved', 'conflict']),
        reasons: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type CommittedProposal = z.infer<typeof proposal>;
export type SessionReceipt = z.infer<typeof receipt>;
export const conciergeSessionSchema = z
  .object({
    version: z.literal(3),
    missionId: z.string().min(1),
    brief: briefStateV3Schema,
    products: z.array(savedProductSchema).max(12),
    selectionRecords: z.array(savedProductSchema).max(12),
    compareIds: z.array(z.string()).max(3),
    combinationIds: z.array(z.string()).max(3),
    combinationQuantities: z.record(z.string(), z.number().int().min(1).max(10)),
    activeView: z.enum(['discover', 'saved', 'compare', 'combination']),
    receipts: z.array(receipt).max(200),
    committedProposal: proposal.nullable().optional(),
    evidence: z
      .array(
        z
          .object({
            evidenceRef: z.string().min(1),
            sourceIndex: z.literal('prod_catalog'),
            objectID: z.string().min(1),
            contentHash: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type ConciergeSession = z.infer<typeof conciergeSessionSchema>;
export function validateConciergeSession(value: unknown): ConciergeSession | null {
  try {
    const parsed = conciergeSessionSchema.parse(value);
    const savedIds = new Set(parsed.products.map((product) => product.objectID));
    const selectionIds = new Set(parsed.selectionRecords.map((product) => product.objectID));
    const knownIds = new Set([...savedIds, ...selectionIds]);
    const compareIds = new Set(parsed.compareIds);
    const combinationIds = new Set(parsed.combinationIds);
    if (
      savedIds.size !== parsed.products.length ||
      selectionIds.size !== parsed.selectionRecords.length ||
      compareIds.size !== parsed.compareIds.length ||
      combinationIds.size !== parsed.combinationIds.length ||
      parsed.compareIds.some((id) => !knownIds.has(id)) ||
      parsed.combinationIds.some((id) => !knownIds.has(id)) ||
      Object.keys(parsed.combinationQuantities).some((id) => !parsed.combinationIds.includes(id))
    )
      return null;
    const registry = new Map<string, SourceBoundProduct>();
    for (const product of [...parsed.products, ...parsed.selectionRecords]) {
      const existing = registry.get(product.objectID);
      if (existing && JSON.stringify(existing) !== JSON.stringify(product)) return null;
      registry.set(product.objectID, product);
    }
    if (parsed.committedProposal) {
      for (const g of parsed.committedProposal.groups)
        for (const l of g.lines) {
          const product = registry.get(l.objectID);
          if (
            !product ||
            product.binding !== 'evidence_bound' ||
            product.evidenceRef !== l.evidenceRef ||
            product.contentHash !== l.contentHash
          )
            return null;
        }
    }
    for (const evidence of parsed.evidence ?? []) {
      const product = registry.get(evidence.objectID);
      if (
        !product ||
        product.binding !== 'evidence_bound' ||
        product.evidenceRef !== evidence.evidenceRef ||
        product.contentHash !== evidence.contentHash
      )
        return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
