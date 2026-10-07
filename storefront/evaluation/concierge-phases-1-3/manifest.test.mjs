// Cases: ten balanced journeys, every expected assertion named, actual UI
// actions are supported, and a completion-request cap cannot impersonate turns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(
  readFileSync(new URL('./scenario-manifest.json', import.meta.url), 'utf8'),
);

test('derives shopper turns from the scenarios, with no arbitrary turn cap', () => {
  assert.ok(manifest.scenarios.length >= 10);
  assert.equal(manifest.coverage.journeyCount, manifest.scenarios.length);
  assert.equal(manifest.execution.requestAccounting.maximumShopperTurns, undefined);
  const plannedTurns = manifest.scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0);
  assert.ok(plannedTurns > 10);
  assert.equal(manifest.execution.requestAccounting.scope, 'cumulative-campaign');
});

test('includes the E21 long continuity journey with at least 22 distinct shopper turns', () => {
  const continuity = manifest.scenarios.filter((scenario) => scenario.tags.includes('continuity'));
  assert.equal(continuity.length, 1);
  assert.ok(continuity[0].turns.length >= 22);
  const texts = continuity[0].turns.map((turn) => turn.text);
  assert.equal(new Set(texts).size, texts.length, 'turns must use varied, unrepeated wording');
});

test('includes the three canonical demo stories as named journeys', () => {
  const demos = manifest.scenarios.filter((scenario) => scenario.family === 'demo');
  assert.equal(demos.length, 3);
  for (const demo of demos) {
    assert.ok(demo.turns.length >= 5, 'demo stories are multi-turn');
    assert.ok(
      demo.turns.every((turn) => turn.text.trim() && turn.expects.length >= 1),
      'demo turns carry text and expectations',
    );
  }
});

test('reserved wording variants reference real scenarios and turns without changing them', () => {
  const variants = manifest.execution.wordingVariantsDeclared ?? [];
  assert.ok(variants.length >= 1, 'at least one wording variant is reserved per the test plan');
  for (const variant of variants) {
    const scenario = manifest.scenarios.find((item) => item.id === variant.forScenarioId);
    assert.ok(scenario, `variant references unknown scenario ${variant.forScenarioId}`);
    assert.ok(variant.turnIndex >= 0 && variant.turnIndex < scenario.turns.length);
    assert.ok(variant.variantText.trim());
    assert.notEqual(
      variant.variantText,
      scenario.turns[variant.turnIndex].text,
      'a variant must differ from the original wording',
    );
  }
});

test('UI action declarations name implemented Save and Compare controls', () => {
  const allowed = new Set(['save-first', 'compare-first-saved', 'combination-add-first']);
  const actions = manifest.scenarios.flatMap((scenario) =>
    scenario.turns.flatMap((turn) => [...(turn.beforeUiActions ?? []), ...(turn.uiActions ?? [])]),
  );
  assert.ok(actions.some((action) => action.kind === 'save-first' && action.count === 5));
  assert.ok(actions.some((action) => action.kind === 'compare-first-saved' && action.count === 2));
  for (const action of actions) {
    assert.ok(allowed.has(action.kind));
    assert.ok(Number.isSafeInteger(action.count) && action.count > 0);
  }
  // Combination UI actions stay within the three-piece combination limit the
  // workspace enforces (ProductWorkspace.tsx combination limit note).
  for (const action of actions.filter((a) => a.kind === 'combination-add-first')) {
    assert.ok(action.count <= 3, 'combination-add-first cannot exceed the 3-piece limit');
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

test('declares repetition and wording-variant policy per the phase 3 test plan', () => {
  const repetitions = manifest.execution.repetitions;
  assert.equal(repetitions.critical, 3);
  assert.equal(repetitions.standard, 2);
  assert.ok(repetitions.wordingVariantsReserved >= 1);
  assert.ok(Array.isArray(repetitions.criticalFocus) && repetitions.criticalFocus.length >= 5);
});

test('declares reply and UI-action deadlines plus the transport retry cap', () => {
  const deadlines = manifest.execution.deadlines;
  assert.equal(deadlines.liveReplySeconds, 180);
  assert.equal(deadlines.uiActionSeconds, 15);
  assert.ok(deadlines.transportRetriesPerTurn >= 0 && deadlines.transportRetriesPerTurn <= 1);
});

test('declared connected slices are bounded, gated, and never silently launchable', () => {
  for (const slice of manifest.connectedSlices ?? []) {
    assert.equal(slice.status, 'declared-not-launched');
    assert.ok(slice.launchGate && slice.launchGate.length > 20, 'slice must name its launch gate');
    assert.ok(Number.isSafeInteger(slice.turns) && slice.turns > 0);
    assert.ok(
      Number.isSafeInteger(slice.budgetReservation.completionRequests) &&
        slice.budgetReservation.completionRequests > 0,
    );
    assert.ok(slice.mustProve.length >= 1);
  }
});

test('declared adverse evidence fixtures are well-formed and referenceable by scenarios', () => {
  const fixtures = manifest.adverseEvidenceFixtures;
  const ids = fixtures.map((fixture) => fixture.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const fixture of fixtures) {
    assert.ok(fixture.route && fixture.condition);
    assert.ok(Array.isArray(fixture.requiredOutcome) && fixture.requiredOutcome.length >= 1);
    assert.equal(fixture.mode, 'fixture');
  }
  for (const scenario of manifest.scenarios) {
    for (const id of scenario.fixtures ?? []) {
      assert.ok(ids.includes(id), `unknown fixture reference: ${id}`);
    }
  }
});
