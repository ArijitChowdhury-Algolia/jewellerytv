import { defineConfig, devices } from '@playwright/test';

// Stage 2 residual acceptance windows W1-W5 (STAGE2-RESIDUAL-MATRIX-AUDIT-2026-10-07.md).
// Opt-in only; per-window caps are harness stop-conditions set through
// JTV_MAX_COMPLETION_REQUESTS (W1 40, W2 20, W3 15, W4 30, W5 10), never
// assistant-chosen caps. Documented invocation:
//   JTV_RUN_STAGE2_RESIDUAL=1 JTV_MAX_COMPLETION_REQUESTS=40
// R-6 (window W5) additionally requires JTV_STAGE3_PURITY_REPAIR_APPLIED=1.
//
// PER-TEST TIMEOUT, derived like the caps (harness stop-condition, not a product
// SLA): up to 8 planned shopper turns at the test-plan's 180s live-reply deadline
// each = 1440s, plus snapshot and evidence-write headroom.
export default defineConfig({
  testDir: '.',
  testMatch: 'stage2-residual-windows.spec.ts',
  timeout: 30 * 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: '../../test-results/plan-3-1-stage2-residual',
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
