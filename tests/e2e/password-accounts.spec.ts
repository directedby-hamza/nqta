import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.skip(
  process.env.AUTH_MODE !== 'recovery-key',
  'Uses the explicit recovery-key configuration.',
);

async function secretStorage(page: Page) {
  return page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
}

async function fillShopContacts(page: Page) {
  await page.getByLabel('Phone number', { exact: true }).fill('+212600002011');
  await page.getByLabel('Email address', { exact: true }).fill('password.customer@example.com');
}

test('a password account keeps the same purchased card across browsers and rotates recovery credentials', async ({
  browser,
}, testInfo) => {
  // A public member code must never replace the private account identifier or recovery key.
  const origin = String(testInfo.project.use.baseURL);
  const first = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const second = await browser.newContext({ reducedMotion: 'reduce' });
  const recovered = await browser.newContext();
  const merchant = await browser.newContext();
  const outsider = await browser.newContext();
  async function post(request: APIRequestContext, path: string, data: unknown) {
    return request.post(`/api/${path}`, { headers: { origin }, data });
  }
  try {
    const shop = await first.request.get('/api/public/shop/morrow', { timeout: 60000 });
    expect(shop.ok()).toBe(true);
    const customer = await first.newPage();
    await customer.goto('/join/morrow');
    await expect(
      customer.getByRole('heading', { name: 'Morrow Coffee', exact: true }),
    ).toBeVisible();
    await expect(customer.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(customer.getByLabel('Phone number')).toBeVisible();
    await expect(customer.getByLabel('Email address')).toBeVisible();
    await fillShopContacts(customer);
    await customer.getByLabel('First name').fill('Password Customer');
    await customer.getByLabel('Password', { exact: true }).fill('OriginalCustomerPassword123!');
    await customer.getByRole('button', { name: 'Save my card', exact: true }).click();
    const accountId = await customer.getByLabel('Account ID', { exact: true }).inputValue();
    const originalKey = await customer.getByLabel('Recovery key', { exact: true }).inputValue();
    expect(accountId).toBeTruthy();
    expect(originalKey.length).toBeGreaterThanOrEqual(32);
    await expect(
      customer.getByRole('button', { name: 'Save my card', exact: true }),
    ).toBeDisabled();
    expect((await secretStorage(customer)).includes(originalKey)).toBe(false);
    expect(customer.url().includes(originalKey)).toBe(false);
    const downloaded = customer.waitForEvent('download');
    await customer.getByRole('button', { name: 'Download recovery details', exact: true }).click();
    const stream = await (await downloaded).createReadStream();
    let saved = '';
    for await (const chunk of stream!) saved += chunk.toString();
    expect(saved.includes(accountId)).toBe(true);
    expect(saved.includes(originalKey)).toBe(true);
    await customer.getByLabel('I have saved my account ID and recovery key').check();
    await customer.getByRole('button', { name: 'Save my card', exact: true }).click();
    await expect(customer.getByTestId('stamp-progress')).toBeVisible();
    const cardId = new URL(customer.url()).pathname.split('/').pop()!;
    const card = await (await first.request.get(`/api/card/${cardId}`)).json();
    expect(card.totalStamps).toBe(0);
    expect(card.phone).toBeUndefined();
    expect(card.consents).toEqual({ sms: false, whatsapp: false });
    await customer.getByRole('button', { name: 'Card settings' }).click();
    await expect(customer.getByLabel('Promotional SMS from this shop')).toHaveCount(0);
    await expect(
      customer.getByRole('button', { name: 'Request deletion of my personal data' }),
    ).toBeVisible();
    await customer.getByRole('button', { name: 'Close dialog' }).click();
    expect((await outsider.request.get(`/api/card/${cardId}`)).status()).toBe(401);
    expect(
      (
        await post(outsider.request, 'auth/customer/sign-in', {
          accountId: card.memberCode,
          password: 'OriginalCustomerPassword123!',
        })
      ).ok(),
    ).toBe(false);
    expect(
      (
        await post(outsider.request, 'auth/customer/recover', {
          accountId,
          recoveryKey: card.memberCode,
          password: 'WrongPublicCodePassword123!',
        })
      ).ok(),
    ).toBe(false);

    const cashier = await merchant.newPage();
    await cashier.goto('/sign-in');
    await cashier.getByRole('button', { name: 'Explore demo workspace' }).click();
    await expect(cashier).toHaveURL(/overview/);
    await cashier.goto(`/cashier?member=${card.memberCode}`);
    await expect(cashier.getByText('Password Customer', { exact: true }).first()).toBeVisible();
    await cashier.getByLabel('Purchase amount (MAD)').fill('25');
    await cashier.getByRole('button', { name: 'Review purchase' }).click();
    await cashier.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
    await expect(cashier.getByText('Purchase recorded', { exact: true })).toBeVisible();

    const restored = await second.newPage();
    await restored.goto('/join/morrow');
    await restored.getByRole('button', { name: 'Sign in to my account', exact: true }).click();
    await restored.getByLabel('Account ID', { exact: true }).fill(accountId);
    await restored.getByLabel('Password', { exact: true }).fill('OriginalCustomerPassword123!');
    await restored.getByRole('button', { name: 'Sign in and open my card', exact: true }).click();
    await expect(restored).toHaveURL(new RegExp(`/card/${cardId}`));
    await expect(restored.getByTestId('stamp-progress')).toHaveAttribute(
      'aria-label',
      '1 of 5 stamps in this cycle',
    );

    const reset = await recovered.newPage();
    await reset.goto('/join/morrow');
    await reset.getByRole('button', { name: 'Use a recovery key', exact: true }).click();
    await reset.getByLabel('Account ID', { exact: true }).fill(accountId);
    await reset.getByLabel('Recovery key', { exact: true }).fill(originalKey);
    await reset.getByLabel('New password', { exact: true }).fill('ChangedCustomerPassword123!');
    await reset.getByLabel('Confirm password', { exact: true }).fill('ChangedCustomerPassword123!');
    await reset.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(reset.getByRole('button', { name: 'Open my card', exact: true })).toBeDisabled();
    const newKey = await reset.getByLabel('Recovery key', { exact: true }).inputValue();
    expect(newKey !== originalKey).toBe(true);
    expect((await secretStorage(reset)).includes(newKey)).toBe(false);
    await reset.getByLabel('I have saved my account ID and recovery key').check();
    await reset.getByRole('button', { name: 'Open my card', exact: true }).click();
    await expect(reset).toHaveURL(new RegExp(`/card/${cardId}`));
    expect((await first.request.get(`/api/card/${cardId}`)).status()).toBe(401);
    expect((await second.request.get(`/api/card/${cardId}`)).status()).toBe(401);
    expect(
      (
        await post(outsider.request, 'auth/customer/sign-in', {
          accountId,
          password: 'OriginalCustomerPassword123!',
        })
      ).ok(),
    ).toBe(false);
    expect(
      (
        await post(outsider.request, 'auth/customer/recover', {
          accountId,
          recoveryKey: originalKey,
          password: 'ReplayPassword123!',
        })
      ).ok(),
    ).toBe(false);
    expect(
      (
        await post(outsider.request, 'auth/customer/sign-in', {
          accountId,
          password: 'ChangedCustomerPassword123!',
        })
      ).ok(),
    ).toBe(true);
    expect((await outsider.request.get(`/api/card/${cardId}`)).status()).toBe(200);
    const nextRecovery = await post(outsider.request, 'auth/customer/recover', {
      accountId,
      recoveryKey: newKey,
      password: 'NextCustomerPassword123!',
    });
    expect(nextRecovery.ok()).toBe(true);
    expect((await nextRecovery.json()).recoveryKey !== newKey).toBe(true);
    expect((await outsider.request.get(`/api/card/${cardId}`)).status()).toBe(200);
  } finally {
    await Promise.all([
      first.close(),
      second.close(),
      recovered.close(),
      merchant.close(),
      outsider.close(),
    ]);
  }
});

test('reloading the one-time key step offers password-confirmed replacement without persisting the key', async ({
  page,
  request,
}, testInfo) => {
  expect((await request.get('/api/public/shop/morrow', { timeout: 60000 })).ok()).toBe(true);
  let joinBody: Record<string, unknown> | undefined;
  let registrations = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/join') && request.method() === 'POST')
      joinBody = request.postDataJSON();
    if (request.url().endsWith('/api/auth/customer/register')) registrations++;
  });
  await page.goto('/join/morrow');
  await fillShopContacts(page);
  await page.getByLabel('Password', { exact: true }).fill('ReloadCustomerPassword123!');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  const accountId = await page.getByLabel('Account ID', { exact: true }).inputValue();
  const originalKey = await page.getByLabel('Recovery key', { exact: true }).inputValue();
  expect((await secretStorage(page)).includes(originalKey)).toBe(false);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your recovery key was shown once.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
  await page.getByLabel('Password', { exact: true }).fill('ReloadCustomerPassword123!');
  await page.getByRole('button', { name: 'Make a replacement recovery key', exact: true }).click();
  const newKey = await page.getByLabel('Recovery key', { exact: true }).inputValue();
  expect(newKey !== originalKey).toBe(true);
  await expect(page.getByLabel('Account ID', { exact: true })).toHaveValue(accountId);
  await expect(page.getByLabel('Phone number', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('');
  expect((await secretStorage(page)).includes(newKey)).toBe(false);
  const oldRecovery = await request.post('/api/auth/customer/recover', {
    headers: { origin: String(testInfo.project.use.baseURL) },
    data: { accountId, recoveryKey: originalKey, password: 'OldKeyReplayPassword123!' },
  });
  expect(oldRecovery.ok()).toBe(false);
  await page.getByLabel('I have saved my account ID and recovery key').check();
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'country code' })).toBeVisible();
  expect(joinBody).toBeUndefined();
  await page.getByLabel('Phone number', { exact: true }).fill('+212600002011');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'valid email address' })).toBeVisible();
  expect(joinBody).toBeUndefined();
  await page.getByLabel('Email address', { exact: true }).fill('password.customer@example.com');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page.getByTestId('stamp-progress')).toBeVisible();
  expect(registrations).toBe(1);
  expect(joinBody?.contacts).toEqual({
    phone: '+212600002011',
    email: 'password.customer@example.com',
  });
  const stored = await secretStorage(page);
  expect(stored).not.toContain(newKey);
  expect(stored).not.toContain('password.customer@example.com');
  expect(
    await page.evaluate(() => sessionStorage.getItem('nqta.customer-shop-enrollment')),
  ).toBeNull();
});

test('an interrupted key save cannot rotate another account signed in from a second tab', async ({
  browser,
}, testInfo) => {
  const customer = await browser.newContext();
  const recovery = await browser.newContext();
  const origin = String(testInfo.project.use.baseURL);
  const password = 'SharedTabCustomerPassword123!';
  try {
    expect((await customer.request.get('/api/public/shop/morrow', { timeout: 60000 })).ok()).toBe(
      true,
    );
    const firstTab = await customer.newPage();
    await firstTab.goto('/join/morrow');
    await fillShopContacts(firstTab);
    await firstTab.getByLabel('Password', { exact: true }).fill(password);
    await firstTab.getByRole('button', { name: 'Save my card', exact: true }).click();
    const accountA = await firstTab.getByLabel('Account ID', { exact: true }).inputValue();
    const keyA = await firstTab.getByLabel('Recovery key', { exact: true }).inputValue();

    // A separate tab has separate sessionStorage and shares the ordinary customer cookie.
    const secondTab = await customer.newPage();
    await secondTab.goto('/join/morrow');
    await fillShopContacts(secondTab);
    await secondTab.getByLabel('Password', { exact: true }).fill(password);
    await secondTab.getByRole('button', { name: 'Save my card', exact: true }).click();
    const accountB = await secondTab.getByLabel('Account ID', { exact: true }).inputValue();
    const keyB = await secondTab.getByLabel('Recovery key', { exact: true }).inputValue();
    expect(accountB !== accountA).toBe(true);
    await secondTab.getByLabel('I have saved my account ID and recovery key').check();
    await secondTab.getByRole('button', { name: 'Save my card', exact: true }).click();
    await expect(secondTab.getByTestId('stamp-progress')).toBeVisible();

    await firstTab.reload();
    await expect(
      firstTab.getByRole('heading', { name: 'Your recovery key was shown once.' }),
    ).toBeVisible();
    await expect(firstTab.getByLabel('Account ID', { exact: true })).toHaveValue(accountA);
    await firstTab.getByLabel('Password', { exact: true }).fill(password);
    const rotationRequest = firstTab.waitForRequest(
      (request) =>
        request.url().endsWith('/api/auth/customer/rotate-recovery-key') &&
        request.method() === 'POST',
    );
    await firstTab
      .getByRole('button', { name: 'Make a replacement recovery key', exact: true })
      .click();
    const rotation = await rotationRequest;
    expect(rotation.postDataJSON().accountId).toBe(accountA);
    expect((await rotation.response())?.status()).toBe(401);
    await expect(
      firstTab.getByRole('alert').filter({ hasText: 'Sign in with the account ID shown here' }),
    ).toBeVisible();
    await expect(firstTab.getByLabel('Account ID', { exact: true })).toHaveValue(accountA);
    await expect(firstTab.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
    expect(await firstTab.evaluate(() => sessionStorage.getItem('nqta.customer-key-save'))).toBe(
      accountA,
    );

    // Both saved keys must still work: the failed replacement changed neither account.
    const recoveredB = await recovery.request.post('/api/auth/customer/recover', {
      headers: { origin },
      data: { accountId: accountB, recoveryKey: keyB, password: 'RecoveredTabBPassword123!' },
    });
    expect(recoveredB.ok()).toBe(true);
    const recoveredA = await recovery.request.post('/api/auth/customer/recover', {
      headers: { origin },
      data: { accountId: accountA, recoveryKey: keyA, password: 'RecoveredTabAPassword123!' },
    });
    expect(recoveredA.ok()).toBe(true);

    await firstTab.getByRole('button', { name: 'Sign in to my account', exact: true }).click();
    await firstTab.getByLabel('Password', { exact: true }).fill('RecoveredTabAPassword123!');
    const signedInRotation = firstTab.waitForRequest(
      (request) =>
        request.url().endsWith('/api/auth/customer/rotate-recovery-key') &&
        request.method() === 'POST',
    );
    await firstTab.getByRole('button', { name: 'Sign in and open my card', exact: true }).click();
    expect((await signedInRotation).postDataJSON().accountId).toBe(accountA);
    await expect(
      firstTab.getByRole('button', { name: 'Save my card', exact: true }),
    ).toBeDisabled();
    await expect(firstTab.getByLabel('Recovery key', { exact: true })).toBeVisible();
  } finally {
    await Promise.all([customer.close(), recovery.close()]);
  }
});
