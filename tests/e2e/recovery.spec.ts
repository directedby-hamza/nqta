import { expect, test } from '@playwright/test';

test('opens the resend form from an expired verification link on the same route', async ({
  page,
}) => {
  await page.goto(`/verify-email?token=${'a'.repeat(64)}`);
  await expect(page.getByRole('button', { name: 'Verify and open workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Request a new verification link' }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send email link' })).toBeVisible();
  await expect(page).toHaveURL(/\/verify-email$/);
});
test('merchant can open an email link, reset a password and revoke its previous browser session', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const creator = await first.newPage();
  const recovery = await second.newPage();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `recovery-${suffix}@example.org`;
  await creator.goto('/create-shop');
  await creator.getByLabel('Your name', { exact: true }).fill('Hana');
  await creator.getByLabel('Shop name', { exact: true }).fill(`Recovery Shop ${suffix}`);
  await creator.getByLabel('Shop location').fill('Rabat, Morocco');
  await creator.getByLabel('Email address').fill(email);
  await creator.getByLabel('Password', { exact: true }).fill('OriginalPassword123!');
  await creator.getByRole('button', { name: 'Create my workspace' }).click();
  await expect(creator).toHaveURL(/overview/);
  await recovery.goto('/forgot-password');
  await recovery.getByLabel('Email address').fill(email);
  await recovery.getByRole('button', { name: 'Send email link' }).click();
  await recovery.getByRole('link', { name: 'Open simulated email link' }).click();
  await recovery.getByLabel('New password', { exact: true }).fill('ChangedPassword123!');
  await recovery.getByLabel('Confirm password').fill('ChangedPassword123!');
  await recovery.getByRole('button', { name: 'Save new password' }).click();
  await expect(recovery.getByRole('status')).toContainText('Your password is updated');
  expect((await first.request.get('/api/workspace')).status()).toBe(401);
  await recovery.getByRole('link', { name: 'Go to sign in' }).click();
  await recovery.getByLabel('Email address').fill(email);
  await recovery.getByLabel('Password', { exact: true }).fill('ChangedPassword123!');
  await recovery.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(recovery).toHaveURL(/overview/);
  await first.close();
  await second.close();
});
