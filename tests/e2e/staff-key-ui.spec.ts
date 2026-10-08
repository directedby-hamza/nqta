import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const key = 'b'.repeat(64);
test.beforeEach(async ({ page }) => {
  await page.route('**/api/public/config', (route) =>
    route.fulfill({ json: { isDemo: false, hostedTest: false, authMode: 'recovery-key' } }),
  );
});

test('workspace creation keeps a one-time downloadable recovery key behind acknowledgement', async ({
  page,
}) => {
  await page.route('**/api/auth/create-workspace', (route) =>
    route.fulfill({ json: { ok: true, recoveryKey: key } }),
  );
  await page.goto('/create-shop');
  await page.getByLabel('Your name', { exact: true }).fill('Hana');
  await page.getByLabel('Shop name', { exact: true }).fill('Saved Key Shop');
  await page.getByLabel('Shop location').fill('Rabat, Morocco');
  await page.getByLabel('Email address').fill('owner@example.org');
  await page.getByLabel('Password', { exact: true }).fill('OriginalPassword123!');
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveValue(key);
  await expect(page.getByRole('button', { name: 'Open my workspace' })).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recovery details' }).click();
  const savedFile = await download;
  expect(savedFile.suggestedFilename()).toBe('nqta-recovery-details.txt');
  expect(await readFile((await savedFile.path())!, 'utf8')).toContain(`Recovery key: ${key}`);
  await page.getByLabel('I have saved my recovery key').check();
  await expect(page.getByRole('button', { name: 'Open my workspace' })).toBeEnabled();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
    key,
  );
  await page.reload();
  await expect(
    page.getByText(/Your account is saved, but this page cannot show your recovery key again/),
  ).toBeVisible();
});

test('invited staff save their recovery key before going to sign in', async ({ page }) => {
  await page.route('**/api/staff/accept', (route) =>
    route.fulfill({ json: { ok: true, recoveryKey: key } }),
  );
  await page.goto(`/invite?token=${'a'.repeat(64)}`);
  await page.getByLabel('Password', { exact: true }).fill('InvitedPassword123!');
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveValue(key);
  await expect(page).toHaveURL(/\/invite$/);
  await expect(page.getByRole('button', { name: 'Go to sign in' })).toBeDisabled();
  await page.getByLabel('I have saved my recovery key').check();
  await page.getByRole('button', { name: 'Go to sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('link', { name: 'Verify your email' })).toHaveCount(0);
});

test('staff reset uses the saved recovery key and requires saving its replacement', async ({
  page,
}) => {
  await page.route('**/api/auth/staff/recover-key', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'owner@example.org',
      recoveryKey: 'a'.repeat(64),
      password: 'ChangedPassword123!',
    });
    await route.fulfill({ json: { ok: true, recoveryKey: key } });
  });
  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill('owner@example.org');
  await page.getByLabel('Recovery key', { exact: true }).fill('a'.repeat(64));
  await page.getByLabel('New password', { exact: true }).fill('ChangedPassword123!');
  await page.getByLabel('Confirm password').fill('ChangedPassword123!');
  await page.getByRole('button', { name: 'Recover my workspace' }).click();
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveValue(key);
  await expect(page.getByRole('button', { name: 'Go to sign in' })).toBeDisabled();
  await page.getByLabel('I have saved my recovery key').check();
  await page.getByRole('button', { name: 'Go to sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('staff can recover again with a saved replacement key after interrupting its acknowledgement step', async ({
  page,
}) => {
  let recoveries = 0;
  await page.route('**/api/auth/staff/recover-key', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'owner@example.org',
      recoveryKey: recoveries === 0 ? 'a'.repeat(64) : key,
      password: recoveries === 0 ? 'ChangedPassword123!' : 'AnotherPassword123!',
    });
    recoveries += 1;
    await route.fulfill({
      json: { ok: true, recoveryKey: recoveries === 1 ? key : 'c'.repeat(64) },
    });
  });
  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill('owner@example.org');
  await page.getByLabel('Recovery key', { exact: true }).fill('a'.repeat(64));
  await page.getByLabel('New password', { exact: true }).fill('ChangedPassword123!');
  await page.getByLabel('Confirm password').fill('ChangedPassword123!');
  await page.getByRole('button', { name: 'Recover my workspace' }).click();
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveValue(key);
  await page.getByLabel('I have saved my recovery key').check();
  await page.reload();
  await expect(page.getByRole('status')).toContainText(
    'cannot show the replacement recovery key again',
  );
  await page.getByRole('link', { name: 'Go to sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('button', { name: 'Recover with my saved key' })).toBeVisible();
  await page.getByRole('button', { name: 'Recover with my saved key' }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('nqta.staff-key-save'))).toBeNull();
  await page.getByLabel('Email address').fill('owner@example.org');
  await page.getByLabel('Recovery key', { exact: true }).fill(key);
  await page.getByLabel('New password', { exact: true }).fill('AnotherPassword123!');
  await page.getByLabel('Confirm password').fill('AnotherPassword123!');
  await page.getByRole('button', { name: 'Recover my workspace' }).click();
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveValue('c'.repeat(64));
  expect(recoveries).toBe(2);
});
