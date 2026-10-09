import { randomInt, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.skip(process.env.AUTH_MODE !== 'recovery-key', 'Uses phone and password accounts.');

const password = 'PrivateCustomerPassword123!';
const phone = () => `06${randomInt(10000000, 100000000)}`;
const international = (value: string) => `+212${value.slice(1)}`;

async function post(request: APIRequestContext, origin: string, path: string, data: unknown) {
  return request.post(`/api/${path}`, { headers: { origin }, data });
}

async function merchantSignIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore demo workspace', exact: true }).click();
  await expect(page).toHaveURL(/overview/);
}

test('a legacy customer enables phone sign-in without changing the earned card or using its contact number', async ({
  browser,
}, testInfo) => {
  const origin = String(testInfo.project.use.baseURL);
  const legacy = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const restored = await browser.newContext({ reducedMotion: 'reduce' });
  const merchant = await browser.newContext({ reducedMotion: 'reduce' });
  const declaredPhone = international(phone());
  const loginPhone = phone();
  try {
    // These credentials represent an existing customer from the previous release.
    const registration = await post(legacy.request, origin, 'auth/customer/register', { password });
    expect(registration.ok()).toBe(true);
    const oldAccount = await registration.json();
    expect(oldAccount.accountId).toMatch(/^NA-/);
    expect(oldAccount.recoveryKey.length).toBeGreaterThanOrEqual(32);
    expect(await (await legacy.request.get('/api/auth/customer/account')).json()).toEqual({
      loginPhone: null,
    });
    const shopResponse = await legacy.request.get('/api/public/shop/morrow');
    expect(shopResponse.ok()).toBe(true);
    const shop = await shopResponse.json();
    const joined = await post(legacy.request, origin, 'join', {
      programmeId: shop.programme.id,
      name: 'Existing Phone Customer',
      contacts: { phone: declaredPhone, email: 'existing.customer@example.com' },
      consents: { sms: false, whatsapp: false },
    });
    expect(joined.ok()).toBe(true);
    const membershipId = (await joined.json()).id;
    const before = await (await legacy.request.get(`/api/card/${membershipId}`)).json();

    const cashier = await merchant.newPage();
    await merchantSignIn(cashier);
    const purchase = await post(merchant.request, origin, 'purchases', {
      membershipId,
      idempotencyKey: `legacy-phone-${randomUUID()}`,
      qualifies: true,
      amountMinor: 2500,
    });
    expect(purchase.ok()).toBe(true);

    const card = await legacy.newPage();
    await card.goto(`/card/${membershipId}?shop=morrow`);
    await expect(card.getByTestId('stamp-progress')).toHaveAttribute(
      'aria-label',
      '1 of 5 stamps in this cycle',
    );
    await expect(card.getByRole('region', { name: 'Your checkout QR' }).locator('code')).toHaveText(
      before.memberCode,
    );
    await card.getByRole('button', { name: 'Card settings' }).click();
    const settings = card.getByRole('dialog', { name: 'Your card, your choices.' });
    await expect(
      settings.getByRole('heading', { name: 'Use my phone to sign in', exact: true }),
    ).toBeVisible();
    await expect(settings.getByLabel('Phone number', { exact: true })).toHaveValue('');
    await expect(settings.getByLabel('Account ID', { exact: true })).toHaveCount(0);
    await expect(settings.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
    await settings.getByLabel('Phone number', { exact: true }).fill(loginPhone);
    await settings
      .getByLabel('Current password', { exact: true })
      .fill('WrongCustomerPassword123!');
    const denied = card.waitForResponse(
      (response) =>
        response.url().endsWith('/api/auth/customer/login-phone') &&
        response.request().method() === 'POST',
    );
    await settings.getByRole('button', { name: 'Enable phone sign-in', exact: true }).click();
    expect((await denied).status()).toBe(401);
    await expect(
      settings.getByRole('alert').filter({ hasText: 'credentials are incorrect' }),
    ).toBeVisible();
    await expect(settings.getByLabel('Current password', { exact: true })).toHaveValue('');
    expect(await (await legacy.request.get('/api/auth/customer/account')).json()).toEqual({
      loginPhone: null,
    });

    await settings.getByLabel('Current password', { exact: true }).fill(password);
    await settings.getByRole('button', { name: 'Enable phone sign-in', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Phone sign-in is enabled');
    await expect(
      settings.getByRole('button', { name: 'Enable phone sign-in', exact: true }),
    ).toHaveCount(0);
    expect(await (await legacy.request.get('/api/auth/customer/account')).json()).toEqual({
      loginPhone: international(loginPhone),
    });
    const stored = await card.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored.includes(password)).toBe(false);
    expect(stored.includes(oldAccount.recoveryKey)).toBe(false);

    expect((await restored.request.get(`/api/card/${membershipId}`)).status()).toBe(401);
    const nextVisit = await restored.newPage();
    await nextVisit.goto('/join/morrow');
    await nextVisit.getByRole('button', { name: 'Sign in to my account', exact: true }).click();
    await nextVisit
      .getByLabel('Phone number or account ID', { exact: true })
      .fill(international(loginPhone));
    await nextVisit.getByLabel('Password', { exact: true }).fill(password);
    await nextVisit.getByRole('button', { name: 'Sign in and open my card', exact: true }).click();
    await expect(nextVisit).toHaveURL(new RegExp(`/card/${membershipId}(?:\\?|$)`));
    await expect(
      nextVisit.getByRole('region', { name: 'Your checkout QR' }).locator('code'),
    ).toHaveText(before.memberCode);
    await expect(nextVisit.getByTestId('stamp-progress')).toHaveAttribute(
      'aria-label',
      '1 of 5 stamps in this cycle',
    );
    const after = await (await restored.request.get(`/api/card/${membershipId}`)).json();
    expect(after.id).toBe(membershipId);
    expect(after.memberCode).toBe(before.memberCode);
    expect(after.totalStamps).toBe(1);
  } finally {
    await Promise.all([legacy.close(), restored.close(), merchant.close()]);
  }
});

for (const interruption of ['retry', 'reload'] as const) {
  test(`signup survives an enrolment failure and ${interruption} without creating another account or card`, async ({
    page,
    browser,
  }) => {
    const loginPhone = phone();
    const displayName = `Retry Customer ${randomUUID().slice(0, 8)}`;
    let registrations = 0;
    let enrollments = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/auth/customer/register') && request.method() === 'POST')
        registrations++;
    });
    await page.route('**/api/join', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      enrollments++;
      if (enrollments === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'The shop is temporarily unavailable. Please try again.' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/join/morrow');
    await page.getByLabel('Full name', { exact: true }).fill(displayName);
    await page.getByLabel('Phone number', { exact: true }).fill(loginPhone);
    await page.getByLabel('Email address', { exact: true }).fill('retry.customer@example.com');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Save my card', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'temporarily unavailable' }),
    ).toBeVisible();
    expect(registrations).toBe(1);
    expect(enrollments).toBe(1);
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    expect(await (await page.request.get('/api/auth/customer/account')).json()).toEqual({
      loginPhone: international(loginPhone),
    });
    expect(await (await page.request.get('/api/customer/shop/morrow')).json()).toEqual({
      membershipId: null,
      loginPhone: international(loginPhone),
    });

    if (interruption === 'reload') {
      await page.reload();
      await expect(page.getByRole('button', { name: 'Save my card', exact: true })).toBeVisible();
      await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue(
        international(loginPhone),
      );
      await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
      await page.getByLabel('Full name', { exact: true }).fill(displayName);
      await page.getByLabel('Email address', { exact: true }).fill('retry.customer@example.com');
    }
    await page.getByRole('button', { name: 'Save my card', exact: true }).click();
    await expect(page).toHaveURL(/\/card\/[^/?]+/);
    const membershipId = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByRole('region', { name: 'Your checkout QR' })).toBeVisible();
    expect(registrations).toBe(1);
    expect(enrollments).toBe(2);
    const cardResponse = await page.request.get(`/api/card/${membershipId}`);
    expect(cardResponse.ok()).toBe(true);
    const card = await cardResponse.json();
    expect(card.name).toBe(displayName);
    expect(card.totalStamps).toBe(0);
    expect(await (await page.request.get('/api/customer/shop/morrow')).json()).toEqual({
      membershipId,
      loginPhone: international(loginPhone),
    });
    await expect(page.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('I have saved my account ID and recovery key')).toHaveCount(0);
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored.includes(password)).toBe(false);
    expect(stored.includes(loginPhone)).toBe(false);

    const merchant = await browser.newContext({ reducedMotion: 'reduce' });
    try {
      const merchantPage = await merchant.newPage();
      await merchantSignIn(merchantPage);
      const members = await merchant.request.get(
        `/api/customers?query=${encodeURIComponent(displayName)}`,
      );
      expect(members.ok()).toBe(true);
      const matches = await members.json();
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe(membershipId);
    } finally {
      await merchant.close();
    }

    await page.goto('/join/morrow');
    await expect(page).toHaveURL(new RegExp(`/card/${membershipId}(?:\\?|$)`));
    expect(registrations).toBe(1);
    expect(enrollments).toBe(2);
  });
}
