import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * These drive a real browser against a real server and a real database. They
 * cover the flows where a break is invisible to unit tests: navigation,
 * form submission, the interview room's state transitions, and the report.
 *
 * The server is started by Playwright unless one is already listening, so the
 * suite works both locally and in CI.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // CI images often ship a Chromium build whose revision does not match
          // the pinned @playwright/test version. Point at the installed binary
          // when PLAYWRIGHT_CHROMIUM_PATH names one rather than downloading a
          // second copy.
          ...(process.env['PLAYWRIGHT_CHROMIUM_PATH']
            ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] }
            : {}),
        },
      },
    },
  ],
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://127.0.0.1:3000/api/health',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
