import { describe, expect, it } from 'vitest';
import { applyBriefOperationsV3, createBriefStateV3, undoBriefV3 } from '../../shared/briefState.js';

describe('v3 preference undo', () => {
  it('restores the previous facts and keeps the removed ID tombstoned', () => {
    const initial = createBriefStateV3('mission');
    const added = applyBriefOperationsV3(initial, {
      missionId: 'mission',
      expectedRevision: 0,
      turnId: 'ui-add-1',
      operations: [{
        type: 'add',
        fact: {
          id: 'fact-1',
          field: 'style',
          value: { kind: 'text', text: 'Understated' },
          scope: { kind: 'mission', key: null },
          strength: 'preference',
          certainty: 'explicit',
          origin: 'ui',
          evidence: { messageId: 'ui-1', quote: 'Understated', explicit: true, verified: true },
        },
      }],
    });
    const undone = undoBriefV3(added, 1);
    expect(undone.revision).toBe(2);
    expect(undone.facts).toEqual([]);
    expect(undone.events).toEqual([]);
    expect(undone.tombstones).toMatchObject([{ factId: 'fact-1' }]);
    expect(() => undoBriefV3(added, 0)).toThrow('Stale brief revision');
  });
});
