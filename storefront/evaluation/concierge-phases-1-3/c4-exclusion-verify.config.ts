import { defineConfig, devices } from '@playwright/test';

// Bounded C4 material-colour exclusion correction: one opt-in paid turn after the
// shared agent schema/instruction save and the compatible app release (8bd3ddc1).
export default defineConfig({
  testDir: '.',
  testMatch: 'c4-exclusion-verify.spec.ts',
  fullyParallel: false,
  retries: 0,
  timeout: 5 * 60_000,
  reporter: 'list',
  outputDir: '../../test-results/plan-3-1-c4-exclusion',
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
