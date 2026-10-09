import { expect, test, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
test.skip(process.env.AUTH_MODE !== 'recovery-key', 'Uses explicit password/key accounts.');

async function createShopCard(page: Page) {
  await page.goto('/join/morrow');
  await page.getByText('Your details (optional)', { exact: true }).click();
  await page.getByLabel('First name').fill('Mina Card');
  await page
    .getByLabel('Phone number', { exact: true })
    .fill(`06${randomInt(10000000, 100000000)}`);
  await page.getByLabel(/Email address/).fill('mina.card@example.com');
  await page.getByLabel('Password', { exact: true }).fill('PrivateWalletCode123!');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page).toHaveURL(/\/card\//);
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
}

test('invalid contact details are corrected before creating a password account', async ({
  page,
}) => {
  let registrations = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/customer/register')) registrations++;
  });
  await page.goto('/join/morrow');
  await page.getByLabel('Phone number', { exact: true }).fill('12345');
  await page.getByLabel('Password', { exact: true }).fill('PrivateWalletCode123!');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'valid phone number' })).toBeVisible();
  expect(registrations).toBe(0);
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('12345');
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
});

test('new enrolment saves a web card without Wallet requests', async ({ page }) => {
  let issued = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/wallet/apple')) issued++;
  });
  await createShopCard(page);
  await expect(page.getByRole('button', { name: 'Save to Apple Wallet', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText(/Apple Wallet|Google Wallet/)).toHaveCount(0);
  await expect(page.getByTestId('stamp-progress')).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const saved = await (await page.request.get('/api/card/' + id)).json();
  expect(saved.name).toBe('Mina Card');
  expect(saved.totalStamps).toBe(0);
  expect(issued).toBe(0);
});

test('a saved checkout QR earns while the customer is signed out without enabling redemption', async ({
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
        name: 'QR Customer',
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
    // A saved QR image encodes this opaque memberCode. Only authenticated staff
    // can record a purchase; no customer cookies are supplied to the cashier.
    await cashier.goto('/cashier?member=' + card.memberCode);
    await expect(cashier.getByText('QR Customer', { exact: true }).first()).toBeVisible();
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
