import { test, expect } from '@playwright/test';

test('platform admin controls payments and access while merchant sessions stay isolated', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/admin/sign-in');
  await expect(page.getByRole('heading', { name: 'Nqta administration' })).toBeVisible();
  await page.getByLabel('Email').fill('admin@browser.test');
  await page.getByLabel('Password', { exact: true }).fill('BrowserTemporary123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your admin password' })).toBeVisible();
  await page.getByLabel('Current password').fill('BrowserTemporary123!');
  await page.getByLabel('New password', { exact: true }).fill('BrowserChangedPassword456!');
  await page.getByLabel('Confirm new password').fill('BrowserChangedPassword456!');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('heading', { name: 'Your shops, in one place.' })).toBeVisible();
  await page.getByRole('button', { name: 'Manage Morrow Coffee' }).click();
  await expect(page.getByRole('heading', { name: 'Morrow Coffee', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await page.getByLabel('Amount received (MAD)').fill('199');
  await page.getByLabel('Payment reference').fill('BROWSER-RECEIPT-001');
  await page.getByLabel('Access through').fill('2099-12-31');
  await page.getByRole('button', { name: 'Save received payment' }).click();
  await expect(
    page.getByRole('heading', { name: 'BROWSER-RECEIPT-001', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Manage access' }).click();
  await page.getByLabel('Access decision').selectOption('suspended');
  await page.getByLabel('Reason').fill('Browser check: payment review');
  await page.getByRole('button', { name: 'Save access' }).click();
  await expect(page.getByText('Suspended', { exact: true }).first()).toBeVisible();
  const merchant = await browser.newContext({ baseURL });
  try {
    await merchant.request.post('/api/auth/staff/sign-in', {
      headers: { Origin: baseURL! },
      data: { email: 'owner@nqta.demo', password: 'NqtaDemo2026!' },
    });
    const merchantPage = await merchant.newPage();
    await merchantPage.goto('/overview');
    await expect(
      merchantPage.getByRole('heading', { name: 'Workspace activation required' }),
    ).toBeVisible();
    expect((await merchant.request.get('/api/admin/shops')).status()).toBe(401);
    expect((await merchant.request.get('/api/overview')).status()).toBe(402);
    await merchantPage.goto('/admin');
    await expect(merchantPage).toHaveURL(/\/admin\/sign-in/);
    await page.getByRole('button', { name: 'Manage access' }).click();
    await page.getByLabel('Access decision').selectOption('active');
    await page.getByLabel('Reason').fill('Browser check complete');
    await page.getByRole('button', { name: 'Save access' }).click();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
    expect((await merchant.request.get('/api/overview')).status()).toBe(200);
  } finally {
    await merchant.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Morrow Coffee', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/admin-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/admin-desktop.png', fullPage: true });
});
