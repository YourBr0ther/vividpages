import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite for the full upload → read journey.
 *
 * There is intentionally no `webServer` block: the suite runs against the
 * real dev stack, which must already be up:
 *
 *   1. docker compose up -d          (postgres, redis, minio)
 *   2. pnpm --filter worker dev      (pipeline worker)
 *   3. pnpm --filter web dev         (Next.js on :3000)
 *   4. pnpm e2e
 *
 * Each run registers its own throwaway user (timestamped email) and deletes
 * the book it uploads, so runs don't interfere with each other or with dev
 * data.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
