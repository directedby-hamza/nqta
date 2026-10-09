import { randomInt, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.AUTH_MODE !== 'recovery-key', 'Uses phone and password accounts.');

const password = 'CompleteProfilePassword123!';
const phone = () => `06${randomInt(10000000, 100000000)}`;
const newsletterLabel = 'I’d like email news and offers from Morrow Coffee';

async function fillProfile(page: Page, fullName: string, email: string) {
  await page.getByLabel('Full name', { exact: true }).fill(fullName);
  await page.getByLabel('Phone number', { exact: true }).fill(phone());
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
}

test('signup requires a complete profile before creating an account and newsletter stays optional', async ({
  page,
}) => {
  let registrations = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/customer/register') && request.method() === 'POST')
      registrations++;
  });
  await page.goto('/join/morrow');
  const name = page.getByLabel('Full name', { exact: true });
  const email = page.getByLabel('Email address', { exact: true });
  const newsletter = page.getByLabel(newsletterLabel, { exact: true });
  await expect(name).toBeVisible();
  await expect(email).toBeVisible();
  await expect(name).toHaveAttribute('autocomplete', 'name');
  await expect(newsletter).not.toBeChecked();
  await page.getByLabel('Phone number', { exact: true }).fill(phone());
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  expect(registrations).toBe(0);
  await name.fill('   ');
  await email.fill('customer@example.com');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /full name/i })).toBeVisible();
  expect(registrations).toBe(0);
  await name.fill('Salma Ben Ali');
  await email.fill('');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  expect(registrations).toBe(0);
  await email.fill('salma.ben.ali@example.com');
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page).toHaveURL(/\/card\/[^/?]+/);
  const membershipId = new URL(page.url()).pathname.split('/').pop()!;
  const response = await page.request.get(`/api/card/${membershipId}`);
  expect(response.ok()).toBe(true);
  const card = await response.json();
  expect(card.name).toBe('Salma Ben Ali');
  expect(card.newsletter).toMatchObject({
    email: 'salma.ben.ali@example.com',
    optedIn: false,
  });
  expect(card.consents).toEqual({ sms: false, whatsapp: false });
  expect(card.memberCode).toMatch(/^NQ-[A-F0-9]{16}$/);
  expect(registrations).toBe(1);
  await expect(page.getByRole('region', { name: 'Your checkout QR' }).locator('code')).toHaveText(
    card.memberCode,
  );
  await page.goto('/join/morrow');
  await expect(page).toHaveURL(new RegExp(`/card/${membershipId}(?:\\?|$)`));
  await expect(page.getByLabel('Full name', { exact: true })).toHaveCount(0);
  expect(registrations).toBe(1);
});

test('email news consent is explicit and can be withdrawn without changing the loyalty card', async ({
  page,
}) => {
  await page.goto('/join/morrow');
  const fullName = `Newsletter Customer ${randomUUID().slice(0, 8)}`;
  await fillProfile(page, fullName, 'newsletter.customer@example.com');
  await page.getByLabel(newsletterLabel, { exact: true }).check();
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page).toHaveURL(/\/card\/[^/?]+/);
  const membershipId = new URL(page.url()).pathname.split('/').pop()!;
  const before = await (await page.request.get(`/api/card/${membershipId}`)).json();
  expect(before.newsletter.optedIn).toBe(true);
  expect(before.newsletter.email).toBe('newsletter.customer@example.com');
  expect(Number.isFinite(Date.parse(before.newsletter.updatedAt))).toBe(true);

  await page.getByRole('button', { name: 'Card settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Your card, your choices.' });
  const choice = settings.getByLabel('Email news and offers from Morrow Coffee', { exact: true });
  await expect(choice).toBeChecked();
  await choice.uncheck();
  await settings.getByRole('button', { name: 'Save my choices', exact: true }).click();
  await expect(settings).toHaveCount(0);
  const after = await (await page.request.get(`/api/card/${membershipId}`)).json();
  expect(after.newsletter.optedIn).toBe(false);
  expect(after.newsletter.email).toBe(before.newsletter.email);
  expect(after.id).toBe(before.id);
  expect(after.memberCode).toBe(before.memberCode);
  expect(after.totalStamps).toBe(before.totalStamps);
  await expect(page.getByRole('region', { name: 'Your checkout QR' }).locator('code')).toHaveText(
    before.memberCode,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Card settings', exact: true }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByLabel('Email news and offers from Morrow Coffee', { exact: true }),
  ).not.toBeChecked();
});

test('the owner sees declared contacts and exports only current newsletter opt-ins', async ({
  page,
  browser,
}) => {
  const fullName = `Owner Profile ${randomUUID().slice(0, 8)}`;
  const email = `owner-profile-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto('/join/morrow');
  await fillProfile(page, fullName, email);
  await page.getByLabel(newsletterLabel, { exact: true }).check();
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page).toHaveURL(/\/card\/[^/?]+/);
  const membershipId = new URL(page.url()).pathname.split('/').pop()!;
  expect((await page.request.get('/api/customers/newsletter-export')).status()).toBe(401);

  const owner = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const merchant = await owner.newPage();
    await merchant.goto('/sign-in');
    await merchant.getByRole('button', { name: 'Explore demo workspace' }).click();
    await expect(merchant).toHaveURL(/\/overview/);
    await merchant.goto('/customers');
    await merchant.getByLabel('Search customers').fill(fullName);
    const row = merchant.getByRole('row').filter({ hasText: fullName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(email);
    await expect(row).toContainText('Email offers: opted in');
    await expect(row).toContainText('+2126');
    const csv = await owner.request.get('/api/customers/newsletter-export');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['cache-control']).toBe('no-store');
    expect(csv.headers()['content-disposition']).toContain('nqta-newsletter.csv');
    expect(await csv.text()).toContain(email);
    const download = merchant.waitForEvent('download');
    await merchant.getByRole('link', { name: 'Export newsletter list', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('nqta-newsletter.csv');

    const withdraw = await page.request.patch('/api/preferences', {
      headers: { origin: new URL(page.url()).origin },
      data: { membershipId, consents: { sms: false, whatsapp: false, email: false } },
    });
    expect(withdraw.status()).toBe(200);
    await merchant.reload();
    await merchant.getByLabel('Search customers').fill(fullName);
    await expect(merchant.getByRole('row').filter({ hasText: fullName })).toContainText(
      'Email offers: not opted in',
    );
    expect(
      await (await owner.request.get('/api/customers/newsletter-export')).text(),
    ).not.toContain(email);
    await merchant.getByRole('button', { name: 'Newsletter opt-in', exact: true }).click();
    await expect(merchant.getByRole('row').filter({ hasText: fullName })).toHaveCount(0);
  } finally {
    await owner.close();
  }
});
