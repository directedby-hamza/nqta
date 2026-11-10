import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.NQTA_E2E_PORT || 3111);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'platform-admin.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --import tsx scripts/admin-e2e-server.ts',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      APP_URL: baseURL,
      DATABASE_URL: '',
      DEMO_MODE: 'true',
      HOSTED_TEST_MODE: 'false',
      AUTH_MODE: 'recovery-key',
      NQTA_E2E_PORT: String(port),
    },
  },
});
