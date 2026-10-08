import { expect, test } from '@playwright/test';
test.skip(process.env.AUTH_MODE !== 'recovery-key', 'Uses explicit password/key accounts.');

test('a saved public Wallet QR earns while the customer is signed out, without enabling redemption', async ({
  browser,
}, info) => {
  const customer = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const merchant = await browser.newContext();
  const origin = String(info.project.use.baseURL);
  try {
    const registration = await customer.request.post('/api/auth/customer/register', {
      headers: { origin },
      data: { password: 'WalletCustomerPassword123!' },
    });
    expect(registration.ok()).toBe(true);
    const shop = await (await customer.request.get('/api/public/shop/morrow')).json();
    const joined = await customer.request.post('/api/join', {
      headers: { origin },
      data: {
        programmeId: shop.programme.id,
        name: 'Wallet Customer',
        consents: { sms: false, whatsapp: false },
      },
    });
    expect(joined.ok()).toBe(true);
    const membership = await joined.json();
    const cardId = membership.id;
    const card = await (await customer.request.get('/api/card/' + cardId)).json();
    expect(card.memberCode).toMatch(/^NQ-[A-F0-9]{16}$/);
    const page = await customer.newPage();
    await page.goto('/card/' + cardId);
    await expect(page.getByTestId('stamp-progress')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to Google Wallet' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add to Apple Wallet' })).toHaveCount(0);
    await customer.request.post('/api/auth/sign-out', {
      headers: { origin },
      data: { kind: 'customer' },
    });
    expect((await customer.request.get('/api/card/' + cardId)).status()).toBe(401);
    await page.close();
    const cashier = await merchant.newPage();
    await cashier.goto('/sign-in');
    await cashier.getByRole('button', { name: 'Explore demo workspace' }).click();
    await expect(cashier).toHaveURL(/overview/);
    // The native pass encodes this same opaque memberCode. No customer cookies
    // are supplied to cashier lookup/earning, just the saved QR's public payload.
    await cashier.goto('/cashier?member=' + card.memberCode);
    await expect(cashier.getByText('Wallet Customer', { exact: true }).first()).toBeVisible();
    await cashier.getByLabel('Purchase amount (MAD)').fill('25');
    await cashier.getByRole('button', { name: 'Review purchase' }).click();
    await cashier.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
    await expect(cashier.getByText('Purchase recorded', { exact: true })).toBeVisible();
    const saved = await (
      await merchant.request.get('/api/membership?code=' + card.memberCode)
    ).json();
    expect(saved.totalStamps).toBe(1);
    expect(
      (
        await customer.request.post('/api/challenge', {
          headers: { origin },
          data: { rewardId: 'unused' },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await customer.close();
    await merchant.close();
  }
});

test('Wallet actions show provider failures and navigate only to the intended save destination', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = 'wallet-ui-card';
  const card = {
    id,
    name: 'Mina',
    status: 'active',
    shopName: 'Coffee',
    location: 'Marrakech',
    theme: '#175c46',
    memberCode: 'NQ-1234567890ABCDEF',
    progress: 2,
    threshold: 5,
    totalStamps: 2,
    rewardDescription: 'One coffee',
    rewards: [],
    consents: { sms: false, whatsapp: false },
    eligibility: 'Paid receipt',
    terms: 'Shop terms',
  };
  // These intercepts test the UI only. Real signing, API ownership and saved
  // economic activity are covered separately; this is not a phone install.
  await page.route('**/api/public/config', (route) =>
    route.fulfill({
      json: { authMode: 'recovery-key', isDemo: false, wallet: { google: true, apple: true } },
    }),
  );
  await page.route('**/api/card/' + id, (route) => route.fulfill({ json: card }));
  await page.route('**/api/wallet/google', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Wallet is unavailable right now. Please try again later.' },
    }),
  );
  await page.goto('/card/' + id);
  await expect(page.getByRole('button', { name: 'Add to Google Wallet' })).toBeVisible();
  const badge = page.getByRole('button', { name: 'Add to Google Wallet' }).locator('img');
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        badge.evaluate((image) => {
          const img = image as HTMLImageElement;
          const bounds = img.getBoundingClientRect();
          return (
            img.complete &&
            img.naturalWidth > 0 &&
            bounds.height >= 48 &&
            bounds.left >= 8 &&
            bounds.right <= window.innerWidth - 8 &&
            Math.abs(bounds.width / bounds.height - img.naturalWidth / img.naturalHeight) < 0.01
          );
        }),
      )
      .toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/nqta-wallet-ui.png', fullPage: true });
  await page.getByRole('button', { name: 'Add to Google Wallet' }).click();
  await expect(
    page.getByRole('region', { name: 'Save your loyalty card' }).getByRole('alert'),
  ).toContainText('Wallet is unavailable');
  await page.route('**/api/wallet/apple', (route) =>
    route.fulfill({ json: { url: '/api/wallet/download/apple/' + id } }),
  );
  await page.route('**/api/wallet/download/apple/' + id, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main>Native download destination reached</main>',
    }),
  );
  await page.getByRole('button', { name: 'Add to Apple Wallet' }).click();
  await expect(page).toHaveURL(new RegExp('/api/wallet/download/apple/' + id));
  await expect(page.getByText('Native download destination reached')).toBeVisible();
});
