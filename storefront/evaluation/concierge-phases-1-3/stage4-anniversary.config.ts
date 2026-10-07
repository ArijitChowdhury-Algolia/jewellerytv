import { defineConfig, devices } from '@playwright/test';

// Stage 4 anniversary journey (STAGE4-ANNIVERSARY-JOURNEY-PLAN-2026-10-07.md):
// one complete uninterrupted paid shopper mission, turns A1 through A8.
// Opt-in only; no paid call starts implicitly. Documented invocation:
//   JTV_RUN_STAGE4_JOURNEY=1 JTV_MAX_COMPLETION_REQUESTS=40
// The request cap is a harness stop-condition, not a product limit; see the
// reconciliation comment at the top of stage4-anniversary.spec.ts.
//
// PER-TEST TIMEOUT, derived like the request cap (harness stop-condition, not
// a product SLA): 8 planned shopper turns at the test-plan's 180s live-reply
// deadline each = 1440s; that also covers 8 x the spec's 120s per-turn
// re-enable deadline (960s) plus headroom for workspace and session
// snapshots, reply/notice settle polls and evidence-capture writes. The
// per-REQUEST ceiling remains the 180s requestTimeoutMs recorded in
// run-budget.json; this setting is only the outer harness ceiling so the run
// can finish and write its ledger.
export default defineConfig({
  testDir: '.',
  testMatch: 'stage4-anniversary.spec.ts',
  timeout: 30 * 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: '../../test-results/plan-3-1-stage4-anniversary',
  use: {
    baseURL: process.env.JTV_E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-1440',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
