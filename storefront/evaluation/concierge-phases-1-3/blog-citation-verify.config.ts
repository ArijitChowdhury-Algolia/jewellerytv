import { defineConfig, devices } from '@playwright/test';

// Blog citation verification: one opt-in paid educational turn after the
// canonical_url Markdown-link instruction was saved to the published Concierge.
export default defineConfig({
  testDir: '.',
  testMatch: 'blog-citation-verify.spec.ts',
  fullyParallel: false,
  retries: 0,
  timeout: 5 * 60_000,
  reporter: 'list',
  outputDir: '../../test-results/plan-3-1-blog-citation',
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
