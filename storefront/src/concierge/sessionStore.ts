import {
  createSessionPersistence,
  type StorageLike,
  type PersistedSession,
} from './sessionPersistence.js';
import {
  validateConciergeSession,
  type ConciergeSession,
} from '../../shared/concierge/sessionContract.js';
export type SessionCommand = {
  expectedRevision: number;
  apply: (session: ConciergeSession) => Promise<ConciergeSession> | ConciergeSession;
};
export function createSessionStore(storage: StorageLike, initialMissionId: string) {
  const persistence = createSessionPersistence(storage, initialMissionId);
  const listeners = new Set<() => void>();
  let snapshot = validateConciergeSession(persistence.load().state);
  const getSnapshot = () => snapshot;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const commitAppliedMutation = async (
    mutator: Parameters<typeof persistence.commitAppliedMutation>[0],
  ) =>
    persistence.commitAppliedMutation(mutator).then((result) => {
      if (result.ok) {
        const validated = validateConciergeSession(result.state);
        if (!validated) return { ok: false as const, reason: 'invalid_mutation' as const };
        snapshot = validated;
        listeners.forEach((listener) => listener());
      }
      return result;
    });
  const transact = async (command: SessionCommand) =>
    commitAppliedMutation(async (current) => {
      const session = validateConciergeSession(current);
      if (!session) return { state: current, result: { status: 'invalid_session' } };
      if (session.brief.revision !== command.expectedRevision)
        return { state: current, result: { status: 'stale_revision' } };
      const next = await command.apply(structuredClone(session));
      return { state: next as PersistedSession, result: { status: 'applied' } };
    });
  const resetMission = async (missionId: string) => {
    const result = await persistence.resetMission(missionId);
    if (result.ok) {
      const validated = validateConciergeSession(result.state);
      if (validated) {
        snapshot = validated;
        listeners.forEach((listener) => listener());
      }
    }
    return result;
  };
  return {
    getSnapshot,
    subscribe,
    transact,
    commitAppliedMutation,
    load: () => ({ state: snapshot }),
    resetMission,
  };
}
