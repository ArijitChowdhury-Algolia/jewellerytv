import { expect, test } from '@playwright/test';
import manifest from '../../evaluation/concierge-phases-1-3/scenario-manifest.json' with { type: 'json' };

test.describe('ConnectedConcierge Phase 3.1 scenario manifest', () => {
  test('contains the required balanced journey coverage', () => {
    expect(manifest.status).toBe('prepared-unexecuted');
    expect(manifest.coverage.journeyCount).toBeGreaterThanOrEqual(10);
    expect(manifest.scenarios).toHaveLength(10);
    for (const family of ['broad-jewelry', 'necklaces', 'rings', 'bracelets', 'watches']) {
      expect(manifest.scenarios.filter((scenario) => scenario.family === family)).toHaveLength(2);
    }
    for (const required of manifest.coverage.requiredBehaviors) {
      expect(manifest.scenarios.some((scenario) => scenario.tags.includes(required))).toBeTruthy();
    }
    for (const scenario of manifest.scenarios) {
      expect(scenario.turns.length).toBeGreaterThanOrEqual(3);
      expect(scenario.turns.every((turn) => turn.text.trim().length > 0)).toBeTruthy();
      expect(scenario.turns.every((turn) => turn.expects.length > 0)).toBeTruthy();
    }
    expect(manifest.coverage.noAssistantProseAssertions).toBe(true);
  });
});
