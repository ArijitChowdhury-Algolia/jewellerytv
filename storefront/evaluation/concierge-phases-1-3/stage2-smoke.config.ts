import { defineConfig, devices } from '@playwright/test';

// Stage 2 bounded API-only smoke (live-smoke-cases.md C1-C6) plus the
// necklace-category reproduction turns. Opt-in only; no paid call starts
// implicitly. Documented invocation for this smoke window:
//   JTV_RUN_STAGE2_SMOKE=1 JTV_MAX_COMPLETION_REQUESTS=40
// The request cap is a harness stop-condition, not a product limit; see the
// reconciliation comment at the top of stage2-smoke.spec.ts.
//
// PER-TEST TIMEOUT, derived like the request cap (harness stop-condition, not
// a product SLA): the whole smoke is a single Playwright test, so Playwright's
// default 30s per-test timeout kills it mid-C2 long before the run completes.
// Derivation: about 10 planned shopper turns at the test-plan's 180s
// live-reply deadline each = 1800s; that also covers 10 x the spec's 120s
// per-turn re-enable deadline (1200s) plus headroom for workspace counting,
// reply/notice settle polls and evidence-capture writes. The per-REQUEST
// ceiling remains the 180s requestTimeoutMs recorded in run-budget.json; this
// setting is only the outer harness ceiling so the run can finish and write
// its ledger.
export default defineConfig({
  testDir: '.',
  testMatch: 'stage2-smoke.spec.ts',
  timeout: 30 * 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: '../../test-results/plan-3-1-stage2-smoke',
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
