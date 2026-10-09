import { expect, test } from '@playwright/test';

const card = {
  id: 'test-card',
  memberCode: 'NQ-0123456789ABCDEF',
  name: 'Mina',
  shopId: 'shop',
  shopName: 'Morrow Coffee',
  shopSlug: 'morrow',
  shopStatus: 'active',
  theme: '#b45b39',
  location: 'Marrakech',
  programmeId: 'programme',
  threshold: 5,
  rewardDescription: 'A coffee',
  eligibility: 'One paid receipt',
  terms: 'Shop terms',
  progress: 0,
  totalStamps: 0,
  rewards: [],
  needsReview: false,
  status: 'active',
  phone: '+212612345600',
  consents: { sms: false, whatsapp: false },
};

test('contact-mode card settings have no password account controls or inactive endpoint requests', async ({
  page,
}) => {
  let passwordRequests = 0;
  await page.route('**/api/public/config', (route) =>
    route.fulfill({ json: { authMode: 'verified-contact', isDemo: false } }),
  );
  await page.route('**/api/card/test-card', (route) => route.fulfill({ json: card }));
  await page.route('**/api/auth/customer/account', (route) => {
    passwordRequests++;
    return route.fulfill({ status: 404, json: { error: 'This sign-in method is unavailable.' } });
  });
  await page.goto('/card/test-card?shop=morrow');
  await expect(page.getByTestId('stamp-progress')).toBeVisible();
  await page.getByRole('button', { name: 'Card settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Your card, your choices.' });
  await expect(settings.getByLabel('Promotional SMS from this shop')).toBeVisible();
  await page.waitForTimeout(500);
  expect(passwordRequests).toBe(0);
  await expect(settings.getByText('This sign-in method is unavailable.')).toHaveCount(0);
  await expect(settings.getByText('Use my phone to sign in', { exact: true })).toHaveCount(0);
});

test('a copied card link retains the shop and signed-out access leads directly to its sign-in', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/public/config', (route) =>
    route.fulfill({ json: { authMode: 'recovery-key', isDemo: false } }),
  );
  await page.route('**/api/card/test-card', (route) =>
    route.fulfill({ json: { ...card, phone: undefined } }),
  );
  await page.goto('/card/test-card?shop=morrow');
  await page.getByRole('button', { name: 'Copy my card link', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Card link copied.' })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).searchParams.get('shop')).toBe('morrow');
  await page.route('**/api/card/test-card', (route) =>
    route.fulfill({ status: 401, json: { error: 'Sign in to recover your card.' } }),
  );
  await page.goto(link);
  await expect(page.getByRole('link', { name: 'Sign in to my card' })).toHaveAttribute(
    'href',
    '/join/morrow?auth=sign-in',
  );
  await expect(page.getByRole('region', { name: 'Your checkout QR' })).toHaveCount(0);
});
