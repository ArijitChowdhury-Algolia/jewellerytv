import { describe, it, expect } from 'vitest';
import {
  newShoppingState,
  restoreShoppingState,
  pinRecord,
  uiFact,
  withBrief,
} from '../src/ShoppingProvider';
import { applyBriefOperations, undoBrief } from '../shared/briefState';
const record = {
  objectID: 'saved',
  Catalog_TitleDescription: 'Saved piece',
  Pricing_ActivePrice: 200,
  Media_Images: [],
};
describe('chat-side brief and independent selections', () => {
  it('migrates legacy numeric budget and retains independently saved records', () => {
    const state = pinRecord(newShoppingState(), record);
    const legacy = { ...state, budgetCents: 20000, budgetScope: 'total' };
    delete (legacy as any).brief;
    const restored = restoreShoppingState(JSON.stringify(legacy));
    expect(restored.products[0].product.id).toBe('saved');
    expect(restored.brief.facts[0].value).toMatchObject({
      kind: 'money',
      cents: 20000,
      basis: 'total',
    });
  });
  it('targeted retraction and undo preserve unrelated exclusions and saved products', () => {
    let state = pinRecord(newShoppingState(), record);
    const heart = uiFact('exclusion', 'no hearts'),
      gold = uiFact('exclusion', 'no yellow gold');
    state = withBrief(
      state,
      applyBriefOperations(state.brief, {
        missionId: state.missionId,
        expectedRevision: 0,
        turnId: 'add',
        operations: [
          { type: 'add', fact: heart },
          { type: 'add', fact: gold },
        ],
      }),
    );
    state = withBrief(
      state,
      applyBriefOperations(state.brief, {
        missionId: state.missionId,
        expectedRevision: 1,
        turnId: 'remove',
        operations: [{ type: 'retract', factIds: [heart.id] }],
      }),
    );
    expect(state.facts.map((f) => f.value)).toEqual(['no yellow gold']);
    expect(state.products[0].product.id).toBe('saved');
    state = withBrief(state, undoBrief(state.brief, 2));
    expect(state.facts.map((f) => f.value)).toEqual(['no hearts', 'no yellow gold']);
    expect(state.brief.revision).toBe(3);
  });
  it('restores a valid v2 brief without reverting its strict numeric operator', () => {
    let state = newShoppingState();
    const fact = uiFact('budget', 'under 200');
    fact.value = { kind: 'money', cents: 20000, currency: 'USD', operator: 'lt', basis: 'total' };
    fact.strength = 'requirement';
    state = withBrief(
      state,
      applyBriefOperations(state.brief, {
        missionId: state.missionId,
        expectedRevision: 0,
        turnId: 'under',
        operations: [{ type: 'add', fact }],
      }),
    );
    expect(restoreShoppingState(JSON.stringify(state)).brief.facts[0].value).toMatchObject({
      operator: 'lt',
    });
  });
});
