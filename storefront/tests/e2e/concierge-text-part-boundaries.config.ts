import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'concierge-text-part-boundaries.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    launchOptions: {
      executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
