import { chromium } from '@playwright/test';

const origin = new URL(process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100').origin;
const password = process.env.TEST_ACCESS_PASSWORD;
if (!password) throw new Error('Set TEST_ACCESS_PASSWORD for the test site.');
const browser = await chromium.launch({ headless: true });
try {
  const locked = await browser.newContext();
  for (const path of ['/', '/api/workspace', '/_next/static/test.js']) {
    const result = await locked.request.get(origin + path);
    if (result.status() !== 401) throw new Error(`${path}: expected 401, got ${result.status()}`);
  }
  const health = await locked.request.get(origin + '/api/health');
  if (health.status() !== 200 || (await health.json()).status !== 'ok')
    throw new Error('Liveness failed.');
  const allowed = await browser.newContext({
    httpCredentials: { username: 'nqta', password },
    viewport: { width: 390, height: 844 },
  });
  const page = await allowed.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const response = await page.goto(origin);
  await page.getByRole('heading', { name: /Turn a visit/ }).waitFor();
  await page.getByRole('link', { name: 'Explore the demo' }).waitFor();
  if (response.status() !== 200 || response.headers()['x-robots-tag'] !== 'noindex, nofollow')
    throw new Error('Protected landing failed.');
  const script = await page.locator('script[src]').first().getAttribute('src');
  if ((await allowed.request.get(origin + script)).status() !== 200)
    throw new Error('Authenticated scripts unavailable.');
  const fetchStatus = await page.evaluate(
    async () => (await fetch('/api/health', { method: 'OPTIONS' })).status,
  );
  if (fetchStatus !== 204)
    throw new Error(`Browser did not reuse test-site credentials: ${fetchStatus}`);
  const blockedMutation = await allowed.request.post(origin + '/api/auth/customer/request', {
    headers: { origin: 'https://foreign.example' },
    data: { phone: '+212600000099' },
  });
  if (blockedMutation.status() !== 403) throw new Error('Foreign mutation origin accepted.');
  if (pageErrors.length) throw new Error(pageErrors.join('\n'));
  console.log(
    'PASS: site password, health, mobile page/assets, browser credential reuse, and mutation origin rejection.',
  );
  console.log(
    'This access smoke check does not verify database connectivity or loyalty transactions.',
  );
  await allowed.close();
  await locked.close();
} finally {
  await browser.close();
}
