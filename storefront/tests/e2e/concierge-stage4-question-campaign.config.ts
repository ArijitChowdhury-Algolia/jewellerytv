import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const isolatedOutput = `../../test-results/stage4-question-campaign-${new Date()
  .toISOString()
  .replace(/[:.]/g, '-')}-${randomUUID()}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'concierge-stage4-question-campaign.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: process.env.JTV_STAGE4_QUESTION_OUTPUT_DIR ?? isolatedOutput,
  timeout: 8 * 60_000,
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
