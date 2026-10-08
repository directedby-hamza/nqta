import { expect, test, type Page } from '@playwright/test';
test.skip(process.env.AUTH_MODE !== 'recovery-key', 'Uses explicit password/key accounts.');

async function createShopCard(page: Page) {
  await page.goto('/join/morrow');
  await page.getByLabel('First name').fill('Mina Wallet');
  await page.getByLabel('Phone number', { exact: true }).fill('+212600002015');
  await page.getByLabel('Email address', { exact: true }).fill('mina.wallet@example.com');
  await page.getByLabel('Password', { exact: true }).fill('PrivateWalletCode123!');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  const key = await page.getByLabel('Recovery key', { exact: true }).inputValue();
  expect(key.length).toBeGreaterThanOrEqual(32);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(key);
  await page.getByLabel('I have saved my account ID and recovery key').check();
  return key;
}

test('invalid contact details are corrected before creating a password account', async ({
  page,
}) => {
  let registrations = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/customer/register')) registrations++;
  });
  await page.goto('/join/morrow');
  await page.getByLabel('Phone number', { exact: true }).fill('0600002015');
  await page.getByLabel('Email address', { exact: true }).fill('mina.wallet@example.com');
  await page.getByLabel('Password', { exact: true }).fill('PrivateWalletCode123!');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'country code' })).toBeVisible();
  expect(registrations).toBe(0);
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('0600002015');
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
});

test('new enrolment survives a key-step reload and saves contacts before Apple Wallet handoff', async ({
  page,
}) => {
  // Only the external provider capability and native download are intercepted.
  // Account creation, authenticated join and the saved browser card use the real server.
  await page.route('**/api/public/config', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), wallet: { google: false, apple: true } },
    });
  });
  let issuedMembership = '';
  let joinBody: Record<string, unknown> | undefined;
  let registrations = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/join') && request.method() === 'POST')
      joinBody = request.postDataJSON();
    if (request.url().endsWith('/api/auth/customer/register')) registrations++;
  });
  await page.route('**/api/wallet/apple', async (route) => {
    issuedMembership = route.request().postDataJSON().membershipId;
    const saved = await page.request.get('/api/card/' + issuedMembership);
    expect(saved.ok()).toBe(true);
    const card = await saved.json();
    expect(card.name).toBe('Mina Wallet');
    expect(card.totalStamps).toBe(0);
    expect(card.memberCode).toMatch(/^NQ-[A-F0-9]{16}$/);
    await route.fulfill({ json: { url: '/api/wallet/download/apple/' + issuedMembership } });
  });
  await page.route('**/api/wallet/download/apple/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main>Apple Wallet download handoff</main>' }),
  );
  const key = await createShopCard(page);
  const accountId = await page.getByLabel('Account ID', { exact: true }).inputValue();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('PrivateWalletCode123!');
  await page.getByRole('button', { name: 'Make a replacement recovery key', exact: true }).click();
  await expect(page.getByLabel('Account ID', { exact: true })).toHaveValue(accountId);
  await expect(page.getByLabel('Phone number', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('');
  await page.getByLabel('Phone number', { exact: true }).fill('+212600002015');
  await page.getByLabel('Email address', { exact: true }).fill('mina.wallet@example.com');
  await page.getByLabel('First name').fill('Mina Wallet');
  const replacementKey = await page.getByLabel('Recovery key', { exact: true }).inputValue();
  expect(replacementKey).not.toBe(key);
  await expect(
    page.getByRole('button', { name: 'Save to Apple Wallet', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('I have saved my account ID and recovery key').check();
  await expect(page.getByText('On iPhone, confirm Add in Apple Wallet.')).toBeVisible();
  await page.getByRole('button', { name: 'Save to Apple Wallet', exact: true }).click();
  await expect(page).toHaveURL(/\/api\/wallet\/download\/apple\//);
  expect(issuedMembership).toBeTruthy();
  expect(registrations).toBe(1);
  expect(joinBody?.contacts).toEqual({ phone: '+212600002015', email: 'mina.wallet@example.com' });
  expect(joinBody?.consents).toEqual({ sms: false, whatsapp: false });
  expect(page.url()).not.toContain(key);
  expect(page.url()).not.toContain(replacementKey);
  expect(await page.evaluate(() => sessionStorage.getItem('nqta.customer-key-save'))).toBeNull();
});

test('a native pass download leaves a saved-card completion behind its Wallet confirmation', async ({
  page,
}) => {
  await page.route('**/api/public/config', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), wallet: { google: false, apple: true } },
    });
  });
  let registrations = 0;
  let joins = 0;
  let membershipId = '';
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/customer/register')) registrations++;
    if (request.url().endsWith('/api/join') && request.method() === 'POST') joins++;
  });
  await page.route('**/api/wallet/apple', async (route) => {
    membershipId = route.request().postDataJSON().membershipId;
    expect((await page.request.get('/api/card/' + membershipId)).ok()).toBe(true);
    await route.fulfill({ json: { url: '/api/wallet/download/apple/' + membershipId } });
  });
  // This exercises the browser's actual download behavior, not a page navigation.
  // The bytes are a provider-boundary fixture and do not represent a signed pass installation.
  await page.route('**/api/wallet/download/apple/*', (route) =>
    route.fulfill({
      contentType: 'application/vnd.apple.pkpass',
      headers: { 'content-disposition': 'attachment; filename="nqta.pkpass"' },
      body: 'native-download-fixture',
    }),
  );
  const key = await createShopCard(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save to Apple Wallet', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('nqta.pkpass');
  await expect(page).toHaveURL(/\/join\/morrow$/);
  await expect(
    page.getByRole('heading', { name: 'Your card is ready.', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('On iPhone, confirm Add in Apple Wallet.')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save my card', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create a new account', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(key);
  expect(await page.evaluate(() => sessionStorage.getItem('nqta.customer-key-save'))).toBeNull();
  expect(
    await page.evaluate(() => sessionStorage.getItem('nqta.customer-shop-enrollment')),
  ).toBeNull();
  await page.getByRole('link', { name: 'Open my saved card', exact: true }).click();
  await expect(page.getByTestId('stamp-progress')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/card/' + membershipId);
  expect(registrations).toBe(1);
  expect(joins).toBe(1);
});

test('an unavailable Apple Wallet keeps new enrolment usable as a real saved browser card', async ({
  page,
}) => {
  let issued = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/wallet/apple')) issued++;
  });
  await createShopCard(page);
  await expect(page.getByRole('button', { name: 'Save to Apple Wallet', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('Apple Wallet is not available for this shop yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page.getByTestId('stamp-progress')).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const saved = await (await page.request.get('/api/card/' + id)).json();
  expect(saved.name).toBe('Mina Wallet');
  expect(saved.totalStamps).toBe(0);
  expect(issued).toBe(0);
});

test('Apple Wallet issue failures retain the key step and retry the same saved membership', async ({
  page,
}) => {
  await page.route('**/api/public/config', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), wallet: { google: false, apple: true } },
    });
  });
  let joins = 0;
  const issuedIds: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/join') && request.method() === 'POST') joins++;
  });
  await page.route('**/api/wallet/apple', async (route) => {
    issuedIds.push(route.request().postDataJSON().membershipId);
    await route.fulfill({
      status: 503,
      json: { error: 'Wallet is unavailable right now. Please try again later.' },
    });
  });
  const key = await createShopCard(page);
  await page.getByRole('button', { name: 'Save to Apple Wallet', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wallet is unavailable' })).toBeVisible();
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveValue(key);
  await expect(page.getByRole('link', { name: 'Open my saved card', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save to Apple Wallet', exact: true }).click();
  await expect.poll(() => issuedIds.length).toBe(2);
  expect(joins).toBe(1);
  expect(issuedIds[0]).toBe(issuedIds[1]);
  await page.getByRole('link', { name: 'Open my saved card', exact: true }).click();
  await expect(page.getByTestId('stamp-progress')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/card/' + issuedIds[0]);
  expect(await page.evaluate(() => sessionStorage.getItem('nqta.customer-key-save'))).toBeNull();
});

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
