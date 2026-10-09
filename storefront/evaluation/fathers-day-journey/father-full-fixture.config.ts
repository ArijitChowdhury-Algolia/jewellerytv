import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'father-full-fixture.spec.ts',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  outputDir: '../../test-results/father-full-fixture',
  use: { baseURL: process.env.JTV_E2E_BASE_URL ?? 'http://localhost:5173' },
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
