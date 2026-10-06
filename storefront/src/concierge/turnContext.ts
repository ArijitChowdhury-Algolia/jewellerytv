import type { ConciergeSession } from '../../shared/concierge/sessionContract.js';

const encoder = new TextEncoder();
const MAX_VALUE_BYTES = 1024;
const MAX_CONTEXT_KEYS = 32;
const CHUNK_BYTES = 900;

function byteLength(value: string) {
  return encoder.encode(value).length;
}

function chunksOf(value: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const character of value) {
    if (byteLength(current + character) > CHUNK_BYTES) {
      chunks.push(current);
      current = '';
    }
    current += character;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Session data for continuity, never product evidence or an intent decision. */
export function buildTurnContext(
  session: ConciergeSession | null,
  base: Record<string, string>,
  turn: { turnId: string; sourceMessageId: string },
): Record<string, string> {
  if (!session) throw new Error('Shopping state is unavailable');
  const scopeCode = { mission: 'm', item: 'i', recipient: 'r', component: 'c' } as const;
  const strengthCode = { requirement: 'r', preference: 'p', context: 'c' } as const;
  const certaintyCode = { explicit: 'e', tentative: 't' } as const;
  const shoppingState = {
    factColumns: 'id,field,value,scope,strength,certainty,status',
    activeView: session.activeView,
    facts: session.brief.facts
      .filter((fact) => fact.status === 'active' || fact.status === 'tentative')
      .map(({ id, field, value, scope, strength, certainty, status }) => [
        id,
        field,
        value,
        [scopeCode[scope.kind], scope.key],
        strengthCode[strength],
        certaintyCode[certainty],
        status === 'tentative' ? 't' : 'a',
      ]),
    saved: session.products.map(({ objectID, quantity }) => [objectID, quantity]),
    compareIds: session.compareIds,
    combination: session.combinationIds.map((objectID) => [
      objectID,
      session.combinationQuantities[objectID] ?? 1,
    ]),
    currentGroups:
      session.activeView === 'discover'
        ? (session.committedProposal?.groups ?? []).map((group) => [
            group.title,
            group.lines.map(({ objectID }) => objectID),
          ])
        : [],
  };
  const pieces = chunksOf(JSON.stringify(shoppingState));
  const result: Record<string, string> = {
    ...base,
    missionId: session.missionId,
    briefRevision: String(session.brief.revision),
    turnId: turn.turnId,
    sourceMessageId: turn.sourceMessageId,
    shoppingStateChunks: String(pieces.length),
  };
  pieces.forEach((piece, index) => {
    result[`shoppingState${index}`] = piece;
  });
  const filtered = Object.fromEntries(Object.entries(result).filter(([, value]) => value.trim()));
  if (
    Object.keys(filtered).length > MAX_CONTEXT_KEYS ||
    Object.values(filtered).some((value) => byteLength(value) > MAX_VALUE_BYTES)
  )
    throw new Error('Shopping state exceeds the supported turn context');
  return filtered;
}
