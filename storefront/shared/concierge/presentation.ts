export * from './presentation-contract.js';
import {
  addCents,
  boundPasses,
  deriveCatalogueGroupTitle,
  exactPriceCents,
} from './presentation-contract.js';
import { presentChoicesSchema } from './presentation-contract.js';
import type {
  PresentationContext,
  StagedPresentation,
  PresentationResult,
  StagedGroup,
  StagedLine,
  SelectedLineInput,
  PresentationEvidence,
  PresentationTurnStatus,
  PresentationIssue,
} from './presentation-contract.js';

/** Purely stages Concierge-selected choices. It never publishes or mutates UI state. */
export function presentChoices(
  rawInput: unknown,
  context: PresentationContext,
): PresentationResult {
  const parsed = presentChoicesSchema.safeParse(rawInput),
    prior = context.priorProposal ?? null;
  if (!parsed.success)
    return { status: 'invalid_input', proposal: prior, reasons: ['schema_invalid'] };
  const input = parsed.data;
  const body = input.body;
  if (context.aborted) return { status: 'aborted', proposal: prior, reasons: ['turn_aborted'] };
  if (
    input.missionId !== context.missionId ||
    input.expectedStateRevision !== context.stateRevision
  )
    return { status: 'stale_state', proposal: prior, reasons: ['state_revision_mismatch'] };
  if (
    input.expectedEvidenceBatchRevision !== context.evidenceBatchRevision ||
    input.turnId !== context.turnId
  )
    return {
      status: 'stale_evidence',
      proposal: prior,
      reasons: ['evidence_batch_or_turn_mismatch'],
    };

  const completeLookIssues: PresentationIssue[] = [];
  if (body.kind === 'complete_looks') {
    const anchors = [...new Set(context.acceptedAnchorIds ?? [])];
    body.alternatives.forEach((alternative, alternativeIndex) => {
      for (const objectID of anchors) {
        const matching = alternative.lines.filter((line) => line.objectID === objectID);
        const count = matching.reduce(
          (sum, line) => sum + (line.quantity === 1 ? 1 : line.quantity),
          0,
        );
        if (count !== 1)
          completeLookIssues.push({ kind: 'missing_anchor', alternativeIndex, objectID, count });
      }
      const roles = new Map<string, { componentSlot: string; objectIDs: string[] }>();
      for (const line of alternative.lines) {
        const key = line.componentSlot.trim().toLocaleLowerCase();
        const role = roles.get(key) ?? { componentSlot: line.componentSlot, objectIDs: [] };
        role.objectIDs.push(line.objectID);
        roles.set(key, role);
      }
      for (const role of roles.values()) {
        if (role.objectIDs.length > 1)
          completeLookIssues.push({
            kind: 'duplicate_component_slot',
            alternativeIndex,
            componentSlot: role.componentSlot,
            objectIDs: role.objectIDs,
          });
      }
    });
    if (completeLookIssues.length)
      return {
        status: 'invalid_input',
        proposal: prior,
        reasons: [
          ...new Set(
            completeLookIssues.map((issue) =>
              issue.kind === 'missing_anchor'
                ? 'missing_accepted_anchor'
                : 'duplicate_component_slot',
            ),
          ),
        ],
        details: completeLookIssues,
      };
  }

  const byRef = new Map<string, PresentationEvidence>();
  for (const record of context.evidence) {
    if (byRef.has(record.evidenceRef))
      return { status: 'invalid_evidence', proposal: prior, reasons: ['duplicate_evidence_ref'] };
    byRef.set(record.evidenceRef, record);
  }
  const reasons: string[] = [];
  let hasUnresolvedLine = false;
  const discoveryRefs = new Set<string>(),
    discoveryObjects = new Set<string>(),
    discoveryDescriptions = new Set<string>();
  const unresolved = new Map(
    (context.unresolved ?? []).map((item) => [item.objectID ?? '*', item.reason]),
  );
  let basisFailure:
    | {
        groupIndex: number;
        evidenceRef: string;
        attribute: string;
        expectedValue: string;
        observedValues: string[];
      }
    | undefined;
  const makeGroup = (title: string, lines: SelectedLineInput[]): StagedGroup => {
    const selectedRefs = body.kind === 'product_groups' ? discoveryRefs : new Set<string>(),
      selectedObjects = body.kind === 'product_groups' ? discoveryObjects : new Set<string>();
    const staged: StagedLine[] = lines.map((line) => {
      if (selectedRefs.has(line.evidenceRef)) throw new Error('duplicate_evidence_ref');
      selectedRefs.add(line.evidenceRef);
      const found = byRef.get(line.evidenceRef);
      if (
        !found ||
        found.source !== 'prod_catalog' ||
        found.objectID !== line.objectID ||
        found.contentHash !== line.contentHash ||
        found.missionId !== context.missionId ||
        found.stateRevision !== context.stateRevision ||
        found.evidenceBatchRevision !== context.evidenceBatchRevision ||
        found.turnId !== context.turnId
      )
        throw new Error('unknown_or_mismatched_evidence');
      if (selectedObjects.has(line.objectID)) throw new Error('duplicate_product_id');
      selectedObjects.add(line.objectID);
      if (body.kind === 'product_groups') {
        const title = found.record.Catalog_TitleDescription,
          description = found.record.Catalog_LongDescription;
        if (
          typeof title === 'string' &&
          title.trim() &&
          typeof description === 'string' &&
          description.trim()
        ) {
          const signature = `${title.trim().toLocaleLowerCase()}\u0000${description.trim().toLocaleLowerCase()}`;
          if (discoveryDescriptions.has(signature))
            throw new Error('duplicate_catalogue_description');
          discoveryDescriptions.add(signature);
        }
      }
      const unit = exactPriceCents(found.record),
        explicitCurrency = found.record.Pricing_Currency ?? found.record.Currency;
      if (explicitCurrency !== undefined && explicitCurrency !== 'USD')
        reasons.push(`${line.objectID}:currency`);
      if (unit === null) reasons.push(`${line.objectID}:price`);
      const unresolvedReason = unresolved.get(line.objectID) ?? unresolved.get('*');
      const contentsUnresolved = body.kind === 'complete_looks' && found.contentsVerified !== true;
      if (unresolvedReason) reasons.push(`${line.objectID}:${unresolvedReason}`);
      if (contentsUnresolved) reasons.push(`${line.objectID}:packaged_contents`);
      const lineSubtotalCents =
        !unresolvedReason &&
        unit !== null &&
        !unresolvedReason &&
        !contentsUnresolved &&
        (explicitCurrency === undefined || explicitCurrency === 'USD') &&
        Number.isSafeInteger(unit * line.quantity)
          ? unit * line.quantity
          : null;
      if (
        lineSubtotalCents === null &&
        unit !== null &&
        !unresolvedReason &&
        !unresolvedReason &&
        !contentsUnresolved
      )
        reasons.push(`${line.objectID}:line_subtotal`);
      if (lineSubtotalCents === null) hasUnresolvedLine = true;
      const unresolvedLine =
        unit === null ||
        !!unresolvedReason ||
        contentsUnresolved ||
        !Number.isSafeInteger(unit === null ? 0 : unit * line.quantity) ||
        (explicitCurrency !== undefined && explicitCurrency !== 'USD');
      return {
        ...line,
        unitPriceCents: unresolvedLine ? null : unit,
        lineSubtotalCents,
      };
    });
    return {
      title,
      lines: staged,
      itemSubtotalCents:
        body.kind === 'product_groups'
          ? null
          : staged.reduce<number | null>((sum, line) => addCents(sum, line.lineSubtotalCents), 0),
    };
  };
  let groups: StagedGroup[];
  try {
    groups =
      body.kind === 'product_groups'
        ? body.groups.map((group, groupIndex) => {
            const staged = makeGroup('', group.items);
            const selected = group.items.map((line) => byRef.get(line.evidenceRef));
            const mismatchIndex = selected.findIndex((record) => {
              if (!record) return true;
              const actual = record.record[group.basis.attribute];
              return Array.isArray(actual)
                ? !actual.some((value) => value === group.basis.value)
                : actual !== group.basis.value;
            });
            if (mismatchIndex !== -1) {
              const actual = selected[mismatchIndex]?.record[group.basis.attribute];
              basisFailure = {
                groupIndex,
                evidenceRef: group.items[mismatchIndex].evidenceRef,
                attribute: group.basis.attribute,
                expectedValue: group.basis.value,
                observedValues: (Array.isArray(actual) ? actual : [actual]).filter(
                  (value): value is string => typeof value === 'string',
                ),
              };
              throw new Error('group_basis_mismatch');
            }
            return { ...staged, title: deriveCatalogueGroupTitle(group.basis) };
          })
        : body.alternatives.map((alternative) => makeGroup(alternative.title, alternative.lines));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'invalid_evidence';
    return {
      status: code === 'unknown_or_mismatched_evidence' ? 'invalid_evidence' : 'invalid_input',
      proposal: prior,
      reasons: [code],
      ...(basisFailure ? { basisFailure } : {}),
    };
  }
  // Each product group is an alternative. Never add alternatives together.
  const combined = null;
  const prices = groups.flatMap((group) => group.lines).map((line) => line.unitPriceCents);
  let perItem: StagedPresentation['assessment']['perItem'] = 'accepted',
    total: StagedPresentation['assessment']['total'] = 'accepted';
  const budgetIssues: PresentationIssue[] = [];
  if (context.budgetContextVerified !== true) {
    reasons.push('budget:missing_context');
    perItem = 'unresolved';
    total = 'unresolved';
  }
  for (const bound of context.bounds ?? []) {
    if (bound.currency !== 'USD' || bound.operator === 'around') {
      reasons.push(`budget:${bound.currency}:${bound.operator}`);
      perItem = 'unresolved';
      total = 'unresolved';
      continue;
    }
    const amounts =
      bound.basis === 'per-item'
        ? prices
        : body.kind === 'product_groups'
          ? groups.flatMap((group) => group.lines.map((line) => line.lineSubtotalCents))
          : groups.map((group) => group.itemSubtotalCents);
    if (amounts.some((amount) => amount === null)) {
      reasons.push(`budget:${bound.basis}:unresolved`);
      if (bound.basis === 'per-item') perItem = 'unresolved';
      else total = 'unresolved';
      continue;
    }
    if (amounts.some((amount) => !boundPasses(amount!, bound))) {
      reasons.push(`budget:${bound.basis}:conflict`);
      if (bound.basis === 'per-item') perItem = 'conflict';
      else total = 'conflict';
      if (body.kind === 'complete_looks') {
        amounts.forEach((amount, index) => {
          if (amount !== null && !boundPasses(amount, bound))
            budgetIssues.push({
              kind: 'budget_conflict',
              basis: bound.basis,
              operator: bound.operator,
              boundCents: bound.cents,
              subtotalCents: amount,
              ...(bound.basis === 'total'
                ? { alternativeIndex: index }
                : { objectID: groups.flatMap((group) => group.lines)[index]?.objectID }),
            });
        });
      }
    }
  }
  if (
    hasUnresolvedLine ||
    reasons.some((reason) =>
      /:price|:owned_context|:packaged_contents|:currency|unresolved/.test(reason),
    )
  ) {
    if (perItem === 'accepted') perItem = 'unresolved';
    if (total === 'accepted') total = 'unresolved';
  }
  const proposal: StagedPresentation = {
    missionId: input.missionId,
    stateRevision: input.expectedStateRevision,
    evidenceBatchRevision: input.expectedEvidenceBatchRevision,
    turnId: input.turnId,
    proposalId: input.proposalId,
    kind: body.kind,
    groups,
    combinedItemSubtotalCents: combined,
    assessment: { perItem, total, reasons: [...reasons] },
  };
  if (budgetIssues.length)
    return { status: 'budget_conflict', proposal, reasons, details: budgetIssues };
  return { status: 'staged', proposal, reasons };
}

/** Compare-and-stage gate. A caller commits only when versions remain current. */
export function commitStagedChoices(
  staged: StagedPresentation,
  current: Pick<
    PresentationContext,
    'missionId' | 'stateRevision' | 'evidenceBatchRevision' | 'turnId'
  > & { turnStatus: PresentationTurnStatus },
  priorProposal: StagedPresentation | null = null,
):
  | { status: 'committed'; proposal: StagedPresentation }
  | { status: 'stale_state' | 'aborted'; proposal: StagedPresentation | null } {
  if (current.turnStatus !== 'completed') {
    return {
      status: current.turnStatus === 'aborted' ? 'aborted' : 'stale_state',
      proposal: priorProposal,
    };
  }
  if (
    staged.missionId !== current.missionId ||
    staged.stateRevision !== current.stateRevision ||
    staged.evidenceBatchRevision !== current.evidenceBatchRevision ||
    staged.turnId !== current.turnId
  )
    return { status: 'stale_state', proposal: priorProposal };
  return { status: 'committed', proposal: staged };
}

export const prepareProductChoices = presentChoices;
export const stageProductChoices = presentChoices;
export const commitProductChoices = commitStagedChoices;
