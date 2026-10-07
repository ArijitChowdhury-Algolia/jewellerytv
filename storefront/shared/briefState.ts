import {
  briefPatchSchema,
  briefStateSchema,
  briefStateV3Schema,
  briefV3FactInputSchema,
  hasAcceptedSourceEvidence,
  type BriefState,
  type BriefPatch,
  type BriefFactInput,
  type BriefFactV2,
  type BriefStateV3,
  type BriefFactV3,
} from './briefSchema.js';
import type { BriefFact, BriefProposal } from './shopping.js';
import { isUpperMoneyBound } from './moneyBounds.js';
export function createBriefState(missionId: string): BriefState {
  return briefStateSchema.parse({
    version: 2,
    missionId,
    revision: 0,
    facts: [],
    processedTurns: [],
    tombstones: [],
    events: [],
  });
}
export function createBriefStateV3(missionId: string): BriefStateV3 {
  return briefStateV3Schema.parse({
    version: 3,
    missionId,
    revision: 0,
    facts: [],
    processedTurns: [],
    tombstones: [],
    events: [],
  });
}
/** Lossless one-way reader migration. V2 remains untouched for existing consumers. */
export function migrateBriefStateV2ToV3(input: BriefState): BriefStateV3 {
  const old = briefStateSchema.parse(input);
  const migrateFact = (f: BriefState['facts'][number]): BriefFactV3 =>
    ({
      ...f,
      certainty: f.status === 'tentative' ? ('tentative' as const) : ('explicit' as const),
      scope: { ...f.scope, key: f.scope.key ?? null },
      value:
        f.value.kind === 'money'
          ? {
              ...f.value,
              operator: f.value.operator as 'lt' | 'lte' | 'gt' | 'gte',
              basis: f.value.basis,
            }
          : f.value,
    }) as BriefFactV3;
  const facts: BriefFactV3[] = old.facts.map(migrateFact);
  return briefStateV3Schema.parse({
    version: 3,
    missionId: old.missionId,
    revision: old.revision,
    facts,
    processedTurns: old.processedTurns,
    tombstones: old.tombstones,
    events: old.events.map((event) => ({
      ...(event.resetEvidence ? { resetEvidence: event.resetEvidence } : {}),
      revision: event.revision,
      turnId: event.turnId,
      beforeFacts: event.beforeFacts.map(migrateFact),
      beforeTombstones: event.beforeTombstones,
    })),
  });
}
export type BriefPatchV3 = {
  missionId: string;
  expectedRevision: number;
  turnId: string;
  operations: readonly (
    | { type: 'add'; fact: import('./briefSchema.js').BriefFactV3Input }
    | { type: 'replace'; factIds: string[]; fact: import('./briefSchema.js').BriefFactV3Input }
    | { type: 'retract'; factIds: string[] }
  )[];
};
// Scope keys retain their exact identity. Folding only detects ambiguous new keys.
function hasItemScopeCollision(state: BriefStateV3, input: BriefPatchV3): boolean {
  const incoming = input.operations.flatMap((operation) =>
    'fact' in operation && operation.fact.scope.kind === 'item' && operation.fact.scope.key
      ? [operation.fact.scope.key]
      : [],
  );
  const live = state.facts.flatMap((fact) =>
    (fact.status === 'active' || fact.status === 'tentative') && fact.scope.kind === 'item'
      ? [fact.scope.key!]
      : [],
  );
  return incoming.some((key) =>
    [...incoming, ...live].some(
      (other) =>
        other !== key &&
        other.normalize('NFKC').toLowerCase() === key.normalize('NFKC').toLowerCase(),
    ),
  );
}
export function applyBriefOperationsV3(
  state: BriefStateV3,
  input: BriefPatchV3,
  now = new Date().toISOString(),
): BriefStateV3 {
  const current = briefStateV3Schema.parse(state);
  if (input.missionId !== current.missionId) throw new Error('Stale brief mission');
  if (current.processedTurns.includes(input.turnId)) return current;
  if (input.expectedRevision !== current.revision) throw new Error('Stale brief revision');
  const next = structuredClone(current),
    revision = current.revision + 1;
  const beforeFacts = structuredClone(current.facts);
  const beforeTombstones = structuredClone(current.tombstones);
  for (const op of input.operations) {
    if ('factIds' in op && new Set(op.factIds).size !== op.factIds.length)
      throw new Error('Duplicate target fact ID');
    const targets =
      'factIds' in op
        ? op.factIds.map((id) => {
            const f = next.facts.find(
              (x) => x.id === id && (x.status === 'active' || x.status === 'tentative'),
            );
            if (!f) throw new Error('Missing active target fact');
            return f;
          })
        : [];
    if (op.type === 'replace' || op.type === 'retract')
      for (const f of targets) {
        f.status = op.type === 'replace' ? 'superseded' : 'retracted';
        f.revision = revision;
        next.tombstones.push({
          factId: f.id,
          messageId: f.evidence.messageId,
          quote: f.evidence.quote,
          revision,
        });
      }
    if (op.type === 'add' || op.type === 'replace') {
      const f = briefV3FactInputSchema.parse(op.fact);
      if (next.facts.some((x) => x.id === f.id) || next.tombstones.some((x) => x.factId === f.id))
        throw new Error('Previously recorded or removed fact');
      next.facts.push({
        ...f,
        status: f.certainty === 'explicit' ? 'active' : 'tentative',
        revision,
        createdAt: now,
      });
    }
  }
  if (hasItemScopeCollision(next, input)) throw new Error('ITEM_SCOPE_KEY_COLLISION');
  next.revision = revision;
  next.processedTurns = [...next.processedTurns, input.turnId].slice(-200);
  next.tombstones = next.tombstones.slice(-200);
  if (
    JSON.stringify(next.facts) !== JSON.stringify(beforeFacts) ||
    JSON.stringify(next.tombstones) !== JSON.stringify(beforeTombstones)
  ) {
    next.events = [
      ...next.events,
      { revision, turnId: input.turnId, beforeFacts, beforeTombstones },
    ].slice(-20);
  }
  return briefStateV3Schema.parse(next);
}
export function undoBriefV3(state: BriefStateV3, expectedRevision: number): BriefStateV3 {
  const current = briefStateV3Schema.parse(state);
  if (current.revision !== expectedRevision) throw new Error('Stale brief revision');
  const event = current.events.at(-1);
  if (!event) return current;
  const revision = current.revision + 1;
  const undoneAdds = current.facts
    .filter((fact) => !event.beforeFacts.some((old) => old.id === fact.id))
    .map((fact) => ({
      factId: fact.id,
      messageId: fact.evidence.messageId,
      quote: fact.evidence.quote,
      revision,
    }));
  return briefStateV3Schema.parse({
    ...current,
    revision,
    facts: structuredClone(event.beforeFacts),
    tombstones: [...structuredClone(event.beforeTombstones), ...undoneAdds].slice(-200),
    events: current.events.slice(0, -1),
  });
}
/** Edit authority is distinct from resolving the new budget's item/total basis.
 * This narrow replacement changes only already-verified unresolved bounds of the same direction. */
export function canReplaceUnresolvedBudgetTargets(
  fact: BriefFactInput,
  targets: readonly (BriefFactInput | BriefFactV2)[],
) {
  const value = fact.value;
  return (
    fact.field === 'budget' &&
    fact.strength === 'requirement' &&
    fact.evidence.explicit &&
    hasAcceptedSourceEvidence(fact.evidence) &&
    value.kind === 'money' &&
    value.basis === 'unresolved' &&
    targets.length > 0 &&
    targets.every(
      (old) =>
        (old.status === 'active' || old.status === 'tentative') &&
        old.field === 'budget' &&
        old.strength === 'requirement' &&
        old.evidence.explicit &&
        hasAcceptedSourceEvidence(old.evidence) &&
        old.value.kind === 'money' &&
        old.value.basis === 'unresolved' &&
        old.value.currency === value.currency &&
        isUpperMoneyBound(old.value.operator) === isUpperMoneyBound(value.operator) &&
        old.scope.kind === fact.scope.kind &&
        (fact.scope.kind === 'mission' || old.scope.key === fact.scope.key),
    )
  );
}
export function applyBriefOperations(
  state: BriefState,
  input: BriefPatch,
  now = new Date().toISOString(),
): BriefState {
  const current = briefStateSchema.parse(state),
    patch = briefPatchSchema.parse(input);
  if (patch.missionId !== current.missionId) throw new Error('Stale brief mission');
  if (current.processedTurns.includes(patch.turnId)) return current;
  if (patch.expectedRevision !== current.revision) throw new Error('Stale brief revision');
  const next = structuredClone(current),
    revision = current.revision + 1;
  for (const op of patch.operations) {
    const unresolvedMoney =
      'fact' in op && op.fact.value.kind === 'money' && op.fact.value.basis === 'unresolved';
    if (op.type === 'reset-brief') {
      if (op.evidence && (!op.evidence.explicit || !op.evidence.verified))
        throw new Error('Brief reset requires verified explicit evidence');
      for (const f of next.facts.filter((f) => f.status === 'active' || f.status === 'tentative')) {
        f.status = 'retracted';
        f.revision = revision;
        next.tombstones.push({
          factId: f.id,
          messageId: f.evidence.messageId,
          quote: f.evidence.quote,
          revision,
        });
      }
    }
    const targets =
      'factIds' in op
        ? op.factIds.map((id) => {
            const f = next.facts.find(
              (f) => f.id === id && (f.status === 'active' || f.status === 'tentative'),
            );
            if (!f) throw new Error('Missing active target fact');
            return f;
          })
        : [];
    const verifiedUnresolvedEdit =
      op.type === 'replace' &&
      unresolvedMoney &&
      canReplaceUnresolvedBudgetTargets(op.fact, targets);
    if (
      (op.type === 'replace' && (!unresolvedMoney || verifiedUnresolvedEdit)) ||
      op.type === 'retract'
    )
      for (const f of targets) {
        f.status = op.type === 'replace' ? 'superseded' : 'retracted';
        f.revision = revision;
        next.tombstones.push({
          factId: f.id,
          messageId: f.evidence.messageId,
          quote: f.evidence.quote,
          revision,
        });
      }
    if (op.type === 'confirm' || op.type === 'mark-tentative')
      for (const f of targets) {
        f.status =
          op.type === 'confirm' && !(f.value.kind === 'money' && f.value.basis === 'unresolved')
            ? 'active'
            : 'tentative';
        f.revision = revision;
        if (op.type === 'confirm') {
          f.origin = 'ui';
          f.evidence = { ...f.evidence, explicit: true, verified: true };
        }
      }
    if (op.type === 'add' || op.type === 'replace') {
      const f = op.fact;
      if (
        next.facts.some((x) => x.id === f.id) ||
        next.tombstones.some(
          (x) =>
            x.factId === f.id ||
            (x.messageId === f.evidence.messageId && x.quote === f.evidence.quote),
        )
      )
        throw new Error('Previously recorded or removed evidence');
      const active =
        !unresolvedMoney &&
        f.status === 'active' &&
        f.evidence.explicit &&
        (f.origin === 'ui' || hasAcceptedSourceEvidence(f.evidence));
      if (op.type === 'replace' && !active && !unresolvedMoney)
        throw new Error('Unverified replacement cannot supersede facts');
      next.facts.push({ ...f, status: active ? 'active' : 'tentative', revision, createdAt: now });
    }
  }
  next.revision = revision;
  next.processedTurns = [...next.processedTurns, patch.turnId].slice(-200);
  next.tombstones = next.tombstones.slice(-200);
  const resetEvidence = patch.operations.find((op) => op.type === 'reset-brief')?.evidence;
  // A processed chat turn still advances revision, but only a changed brief consumes undo history.
  const changed =
    JSON.stringify(next.facts) !== JSON.stringify(current.facts) ||
    JSON.stringify(next.tombstones) !== JSON.stringify(current.tombstones);
  next.events = changed
    ? [
        ...current.events,
        {
          ...(resetEvidence ? { resetEvidence } : {}),
          revision,
          turnId: patch.turnId,
          beforeFacts: current.facts,
          beforeTombstones: current.tombstones,
        },
      ].slice(-20)
    : current.events;
  return briefStateSchema.parse(next);
}
export function undoBrief(state: BriefState, expectedRevision: number): BriefState {
  const s = briefStateSchema.parse(state);
  if (s.revision !== expectedRevision) throw new Error('Stale brief revision');
  const e = s.events.at(-1);
  if (!e) return s;
  // Undo consumes history instead of creating an undo-of-undo toggle. Revision remains monotonic.
  const undoneAdds = s.facts
    .filter((f) => !e.beforeFacts.some((old) => old.id === f.id))
    .map((f) => ({
      factId: f.id,
      messageId: f.evidence.messageId,
      quote: f.evidence.quote,
      revision: s.revision + 1,
    }));
  return {
    ...s,
    revision: s.revision + 1,
    facts: structuredClone(e.beforeFacts),
    tombstones: [...structuredClone(e.beforeTombstones), ...undoneAdds].slice(-200),
    events: s.events.slice(0, -1),
  };
}
export function migrateLegacyBrief(
  missionId: string,
  facts: readonly BriefFact[],
  proposals: readonly BriefProposal[] = [],
): BriefState {
  const operations = [...facts, ...proposals].slice(-100).map((f, index) => ({
    type: 'add' as const,
    fact: {
      id: `legacy-${index}-${f.id}`.slice(0, 300),
      field: f.field,
      value: { kind: 'text' as const, text: f.value },
      scope: f.scope ? { kind: 'item' as const, key: f.scope } : { kind: 'mission' as const },
      strength: 'preference' as const,
      status: f.status === 'confirmed' ? ('active' as const) : ('tentative' as const),
      origin: 'ui' as const,
      evidence: {
        messageId: f.messageId,
        quote: f.quote || f.value,
        explicit: f.status === 'confirmed',
        verified: f.status === 'confirmed',
      },
    } satisfies BriefFactInput,
  }));
  let s = createBriefState(missionId);
  for (let i = 0; i < operations.length; i += 40)
    s = applyBriefOperations(s, {
      missionId,
      expectedRevision: s.revision,
      turnId: `migration-${i}`,
      operations: operations.slice(i, i + 40),
    });
  return s;
}
