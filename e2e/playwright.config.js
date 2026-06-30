// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * BlastyBiz Playwright config.
 * Targets the live Firebase-hosted site: https://blastybiz-9523e.web.app
 *
 * Auth credentials are read from environment variables:
 *   PLAYWRIGHT_TEST_EMAIL    (default: playwright@blastybiz.dev)
 *   PLAYWRIGHT_TEST_PASSWORD (required)
 *
 * Run: cd e2e && npm install && npx playwright install chromium && npx playwright test
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'https://blastybiz-9523e.web.app',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
