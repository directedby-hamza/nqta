import { expect, test } from '@playwright/test';

test('a customer joins, earns five stamps, and redeems once with staff', async ({ browser }) => {
  const customer = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const merchant = await browser.newContext();
  const client = await customer.newPage();
  const counter = await merchant.newPage();
  await client.goto('/join/morrow');
  const phone = `+2126${String(Date.now()).slice(-8)}`;
  await client.getByLabel('Phone number').fill(phone);
  await client.getByLabel('First name').fill('Journey Customer');
  await client.getByRole('button', { name: 'Get my card' }).click();
  const code = (await client.getByTestId('development-code').textContent())!.match(/\d{6}/)![0];
  await client.getByLabel('Verification code').fill(code);
  await client.getByRole('button', { name: 'Verify and join' }).click();
  await expect(client.getByTestId('stamp-progress')).toBeVisible();
  const cardId = new URL(client.url()).pathname.split('/').pop()!;
  const cardResponse = await customer.request.get(`/api/card/${cardId}`);
  const card = await cardResponse.json();
  expect(card.totalStamps).toBe(0);
  expect(card.consents).toEqual({ sms: false, whatsapp: false });
  await counter.goto('/sign-in');
  await counter.getByRole('button', { name: 'Explore demo workspace' }).click();
  await expect(counter).toHaveURL(/overview/);
  // Use a fresh member per run so the five-purchase boundary is deterministic.
  const start = card.totalStamps;
  const needed = 5 - (start % 5);
  await counter.goto(`/cashier?member=${card.memberCode}`);
  await expect(counter.getByText('Journey Customer', { exact: true }).first()).toBeVisible();
  for (let i = 0; i < needed; i++) {
    await counter.getByLabel('Purchase amount (MAD)').fill('25');
    await counter.getByRole('button', { name: 'Review purchase' }).click();
    await counter.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
    await expect(counter.getByText('Purchase recorded', { exact: true })).toBeVisible();
    await expect(counter.getByLabel('Purchase amount (MAD)')).toHaveValue('');
  }
  await client.reload();
  await expect(client.getByRole('button', { name: 'Use reward' }).first()).toBeVisible();
  await expect(client.locator('.card-content')).toHaveCSS('opacity', '1');
  await client.screenshot({ path: 'test-results/customer-card-mobile.png', fullPage: true });
  await client.getByRole('button', { name: 'Use reward' }).first().click();
  const rewardCode = (await client.getByTestId('redemption-code').textContent())!.trim();
  await counter.getByRole('button', { name: 'Redeem reward', exact: true }).click();
  await counter.getByLabel('Customer confirmation code').fill(rewardCode);
  await counter.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  await expect(counter.getByText('Reward redeemed', { exact: true })).toBeVisible();
  await client.reload();
  await expect(client.getByText('Enjoyed', { exact: true }).first()).toBeVisible();
  await client.getByRole('button', { name: 'Card settings' }).click();
  await client.getByRole('button', { name: 'Sign out of this device' }).click();
  await expect(client).toHaveURL(/recover/);
  await client.goto('/join/morrow');
  await client.getByLabel('Phone number').fill(phone);
  await client.getByRole('button', { name: 'Get my card' }).click();
  const recoveryCode = (await client.getByTestId('development-code').textContent())!.trim();
  await client.getByLabel('Verification code').fill(recoveryCode);
  await client.getByRole('button', { name: 'Verify and join' }).click();
  await expect(client).toHaveURL(new RegExp(`/card/${cardId}`));
  expect((await (await customer.request.get(`/api/card/${cardId}`)).json()).totalStamps).toBe(5);
  await customer.close();
  await merchant.close();
});

test('mobile workspace navigation, manual lookup, and reduced motion remain usable', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore demo workspace' }).click();
  await expect(page.getByRole('heading', { name: /regulars/i })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Customers', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Your people.' })).toBeVisible();
  const overflowing = await page.evaluate(() =>
    Array.from(document.querySelectorAll('body *'))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.right > innerWidth + 1 &&
          getComputedStyle(element).position !== 'fixed' &&
          !element.closest('.table-wrap')
        );
      })
      .map((element) => ({
        tag: element.tagName,
        class: element.className,
        right: Math.round(element.getBoundingClientRect().right),
      })),
  );
  expect(overflowing).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <=
        window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-customers.png', fullPage: true });
  await context.close();
});

test('cashier cannot export activity or open owner settings', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('cashier@nqta.demo');
  await page.getByLabel('Password').fill('NqtaDemo2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/overview/);
  const exportResult = await context.request.get('/api/export?days=30');
  expect(exportResult.status()).toBe(403);
  await page.goto('/settings');
  await expect(
    page.getByText('Settings require owner access. Ask your shop owner for help.'),
  ).toBeVisible();
  await context.close();
});
