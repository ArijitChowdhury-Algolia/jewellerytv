import { z } from 'zod';
import type { EvidenceRecord } from './retrieval/types.js';

const id = z.string().trim().min(1).max(300);
const selectedLine = z
  .object({
    evidenceRef: id,
    objectID: id,
    contentHash: id,
    quantity: z.number().int().min(1).max(20),
    componentSlot: id,
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();
export const CATALOGUE_GROUP_BASIS_ATTRIBUTES = [
  'Catalog_WatchCaseSize',
  'Catalog_WatchCaseShape',
  'Catalog_WatchStyle',
  'Catalog_ProductType',
  'Catalog_RingType',
  'Catalog_EarringType',
  'Catalog_BraceletType',
  'Catalog_NecklaceType',
  'Catalog_GemstoneInformation.GemstoneColorGroup',
] as const;
export const catalogueGroupBasisSchema = z
  .object({
    attribute: z.enum(CATALOGUE_GROUP_BASIS_ATTRIBUTES),
    value: z.string().trim().min(1).max(160),
  })
  .strict();
const productGroups = z
  .object({
    kind: z.literal('product_groups'),
    groups: z
      .array(
        z
          .object({
            basis: catalogueGroupBasisSchema,
            items: z.array(selectedLine).min(1).max(3),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
const completeLooks = z
  .object({
    kind: z.literal('complete_looks'),
    alternatives: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            lines: z.array(selectedLine).min(1).max(3),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
const strictProductGroupsBody = z
  .object({
    kind: z.literal('product_groups'),
    groups: productGroups.shape.groups,
    alternatives: z.null(),
  })
  .strict();
const strictCompleteLooksBody = z
  .object({
    kind: z.literal('complete_looks'),
    groups: z.null(),
    alternatives: completeLooks.shape.alternatives,
  })
  .strict();
const strictPresentationBody = z.discriminatedUnion('kind', [
  strictProductGroupsBody,
  strictCompleteLooksBody,
]);
const envelope = z
  .object({
    missionId: id,
    expectedStateRevision: z.number().int().nonnegative(),
    expectedEvidenceBatchRevision: z.number().int().nonnegative(),
    turnId: id,
    proposalId: id,
  })
  .strict();
export const presentChoicesSchema = envelope.extend({ body: strictPresentationBody });
export type SelectedLineInput = z.infer<typeof selectedLine>;
export type CatalogueGroupBasis = z.infer<typeof catalogueGroupBasisSchema>;
export type PresentationBody = z.infer<typeof strictPresentationBody>;
export type PresentChoicesInput = z.infer<typeof presentChoicesSchema>;
export type PresentationMoneyBound = {
  currency: string;
  basis: 'per-item' | 'total';
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'around';
  cents: number;
};
export type PresentationUnresolved = {
  objectID?: string;
  reason: 'packaged_contents' | 'owned_context' | 'currency' | 'price' | 'other';
};
export type PresentationEvidence = EvidenceRecord & {
  missionId: string;
  stateRevision: number;
  evidenceBatchRevision: number;
  turnId: string;
  contentsVerified?: boolean;
};
export type PresentationIssue =
  | {
      kind: 'missing_anchor';
      alternativeIndex: number;
      objectID: string;
      count: number;
    }
  | {
      kind: 'duplicate_component_slot';
      alternativeIndex: number;
      componentSlot: string;
      objectIDs: string[];
    }
  | {
      kind: 'budget_conflict';
      basis: PresentationMoneyBound['basis'];
      operator: PresentationMoneyBound['operator'];
      boundCents: number;
      subtotalCents: number;
      alternativeIndex?: number;
      objectID?: string;
    };
export type PresentationContext = {
  missionId: string;
  stateRevision: number;
  evidenceBatchRevision: number;
  turnId: string;
  evidence: readonly PresentationEvidence[];
  bounds?: readonly PresentationMoneyBound[];
  budgetContextVerified?: boolean;
  acceptedAnchorIds?: readonly string[];
  unresolved?: readonly PresentationUnresolved[];
  priorProposal?: StagedPresentation | null;
  aborted?: boolean;
};
export type StagedLine = {
  evidenceRef: string;
  objectID: string;
  contentHash: string;
  quantity: number;
  componentSlot: string;
  explanation: string;
  unitPriceCents: number | null;
  lineSubtotalCents: number | null;
};
export type StagedGroup = { title: string; lines: StagedLine[]; itemSubtotalCents: number | null };
export type StagedPresentation = {
  missionId: string;
  stateRevision: number;
  evidenceBatchRevision: number;
  turnId: string;
  proposalId: string;
  kind: PresentationBody['kind'];
  groups: StagedGroup[];
  combinedItemSubtotalCents: number | null;
  assessment: {
    perItem: 'accepted' | 'unresolved' | 'conflict';
    total: 'accepted' | 'unresolved' | 'conflict';
    reasons: string[];
  };
};
export type PresentationResult =
  | {
      status: 'staged';
      proposal: StagedPresentation;
      reasons: string[];
      details?: PresentationIssue[];
    }
  | {
      status:
        | 'invalid_input'
        | 'stale_state'
        | 'stale_evidence'
        | 'invalid_evidence'
        | 'unresolved'
        | 'budget_conflict'
        | 'aborted';
      proposal: StagedPresentation | null;
      reasons: string[];
      details?: PresentationIssue[];
    };
export type PresentationTurnStatus =
  'active' | 'completed' | 'aborted' | 'error' | 'exhausted' | 'stale';

export function exactPriceCents(record: Record<string, unknown>): number | null {
  const price = record.Pricing_ActivePrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return null;
  const raw = price * 100,
    cents = Math.round(raw);
  return Number.isSafeInteger(cents) && Math.abs(raw - cents) < 1e-7 ? cents : null;
}
export function addCents(a: number | null, b: number | null): number | null {
  return a === null || b === null || !Number.isSafeInteger(a + b) ? null : a + b;
}
export function boundPasses(cents: number, bound: PresentationMoneyBound): boolean {
  switch (bound.operator) {
    case 'lt':
      return cents < bound.cents;
    case 'lte':
      return cents <= bound.cents;
    case 'gt':
      return cents > bound.cents;
    case 'gte':
      return cents >= bound.cents;
    case 'around':
      return false;
  }
}

const CATALOGUE_GROUP_BASIS_LABELS: Record<CatalogueGroupBasis['attribute'], string> = {
  Catalog_WatchCaseSize: 'Watch case size',
  Catalog_WatchCaseShape: 'Watch case shape',
  Catalog_WatchStyle: 'Watch style',
  Catalog_ProductType: 'Product type',
  Catalog_RingType: 'Ring style',
  Catalog_EarringType: 'Earring style',
  Catalog_BraceletType: 'Bracelet style',
  Catalog_NecklaceType: 'Necklace style',
  'Catalog_GemstoneInformation.GemstoneColorGroup': 'Gemstone color',
};
export function deriveCatalogueGroupTitle(basis: CatalogueGroupBasis): string {
  return `${CATALOGUE_GROUP_BASIS_LABELS[basis.attribute]}: ${basis.value}`;
}
