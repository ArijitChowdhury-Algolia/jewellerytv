import { defineConfig, devices } from '@playwright/test';

// Separate entry point so the retired tests/e2e scaffold cannot be mistaken for
// this campaign. No server, browser install, or paid call starts implicitly.
export default defineConfig({
  testDir: '.',
  testMatch: 'live.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: '../../test-results/plan-3-1',
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
