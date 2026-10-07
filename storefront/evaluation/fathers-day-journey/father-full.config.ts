import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'father-full.spec.ts',
  timeout: 45 * 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: '../../test-results/father-full',
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
