import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, e2eEnv } from './tests/e2e/env';

const CI = Boolean(process.env.CI);

/**
 * Web server: production build by default; `PW_DEV=1` uses `next dev` (faster locally);
 * `PW_PREBUILT=1` skips the build when `.next` is already built (CI builds in its own step).
 */
const serverCommand =
  process.env.PW_DEV === '1' ? 'npm run dev' : process.env.PW_PREBUILT === '1' ? 'npm run start' : 'npm run build && npm run start';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  // The scenario is stateful (one seeded database), so specs run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: serverCommand,
    url: E2E_BASE_URL,
    reuseExistingServer: !CI,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // The server reads the same throwaway database the global setup seeds.
    env: e2eEnv(),
  },
});
