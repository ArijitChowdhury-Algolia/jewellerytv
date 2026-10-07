import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..');
const runDir = path.join(
  repoRoot,
  '.checkpoint',
  'runs',
  `graduation-fixture-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

export default defineConfig({
  testDir: '.',
  testMatch: 'graduation-fixture.spec.ts',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  outputDir: path.join(runDir, 'playwright-artifacts'),
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
