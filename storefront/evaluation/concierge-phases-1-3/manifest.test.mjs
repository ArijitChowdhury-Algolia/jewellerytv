// Cases: ten balanced journeys, every expected assertion named, actual UI
// actions are supported, and a completion-request cap cannot impersonate turns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(
  readFileSync(new URL('./scenario-manifest.json', import.meta.url), 'utf8'),
);

test('derives shopper turns from the scenarios, with no arbitrary turn cap', () => {
  assert.equal(manifest.scenarios.length, 10);
  assert.equal(manifest.execution.requestAccounting.maximumShopperTurns, undefined);
  const plannedTurns = manifest.scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0);
  assert.ok(plannedTurns > 10);
  assert.equal(manifest.execution.requestAccounting.scope, 'cumulative-campaign');
});

test('UI action declarations name implemented Save and Compare controls', () => {
  const allowed = new Set(['save-first', 'compare-first-saved']);
  const actions = manifest.scenarios.flatMap((scenario) =>
    scenario.turns.flatMap((turn) => [...(turn.beforeUiActions ?? []), ...(turn.uiActions ?? [])]),
  );
  assert.ok(actions.some((action) => action.kind === 'save-first' && action.count === 5));
  assert.ok(actions.some((action) => action.kind === 'compare-first-saved' && action.count === 2));
  for (const action of actions) {
    assert.ok(allowed.has(action.kind));
    assert.ok(Number.isSafeInteger(action.count) && action.count > 0);
  }
});

test('all journey expectations are enumerated for later evidence review', () => {
  for (const scenario of manifest.scenarios) {
    assert.ok(scenario.turns.length >= 3);
    for (const turn of scenario.turns) {
      assert.ok(turn.text.trim());
      assert.ok(turn.expects.length);
      assert.ok(
        turn.expects.every((expectation) => typeof expectation === 'string' && expectation.trim()),
      );
    }
  }
});
