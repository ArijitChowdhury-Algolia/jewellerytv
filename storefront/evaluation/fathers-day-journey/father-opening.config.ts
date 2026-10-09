import { defineConfig, devices } from '@playwright/test';

// Dedicated Father lane. The spec skips without both explicit opt-in and a
// cumulative completion-request stop. No other Plan 3.1 harness is modified.
export default defineConfig({
  testDir: '.',
  testMatch: 'father-opening.spec.ts',
  timeout: 12 * 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: '../../test-results/father-opening',
  use: {
    baseURL: process.env.JTV_E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 1000 } },
    },
  ],
});
