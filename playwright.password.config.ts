import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.NQTA_E2E_PORT || 3211);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid NQTA_E2E_PORT.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    'password-accounts.spec.ts',
    'simple-customer-access.spec.ts',
    'card-access-regressions.spec.ts',
    'staff-key-ui.spec.ts',
    'wallet-cards.spec.ts',
  ],
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  // The one-time credentials must not be recorded in traces or screenshots.
  use: { baseURL, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `${baseURL}/api/health`,
    env: {
      APP_URL: baseURL,
      DATA_DIRECTORY: process.env.NQTA_E2E_DATA_DIRECTORY || '/private/tmp/nqta-password-e2e',
      DATABASE_URL: '',
      DEMO_MODE: 'true',
      HOSTED_TEST_MODE: 'false',
      AUTH_MODE: 'recovery-key',
    },
    reuseExistingServer: false,
    timeout: 120000,
  },
});
