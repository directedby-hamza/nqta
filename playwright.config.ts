import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.NQTA_E2E_PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid NQTA_E2E_PORT.');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    env: {
      APP_URL: baseURL,
      DATA_DIRECTORY: process.env.NQTA_E2E_DATA_DIRECTORY || '.data/e2e',
      DATABASE_URL: '',
      DEMO_MODE: 'true',
      HOSTED_TEST_MODE: 'false',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
