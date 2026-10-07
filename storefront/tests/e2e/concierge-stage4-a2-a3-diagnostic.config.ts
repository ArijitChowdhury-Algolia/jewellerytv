import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'concierge-stage4-a2-a3-diagnostic.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  outputDir: process.env.JTV_STAGE4_OUTPUT_DIR ?? '../../test-results/stage4-a2-a3-diagnostic',
  timeout: 12 * 60_000,
  use: {
    baseURL: process.env.JTV_E2E_BASE_URL ?? 'http://localhost:5173',
    headless: true,
    launchOptions: {
      executablePath:
        process.env.JTV_BRAVE_EXECUTABLE ??
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
