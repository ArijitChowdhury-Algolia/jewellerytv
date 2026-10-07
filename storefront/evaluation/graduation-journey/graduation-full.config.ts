import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const artifactDir = path.join(
  repoRoot,
  '.checkpoint',
  'runs',
  `graduation-playwright-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
export default defineConfig({
  testDir: '.',
  testMatch: 'graduation-full.spec.ts',
  timeout: 50 * 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: artifactDir,
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
