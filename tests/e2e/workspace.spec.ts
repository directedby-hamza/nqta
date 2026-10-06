import { expect, test } from '@playwright/test';
test('new merchant saves a draft and must save changed rules before publication', async ({
  page,
}) => {
  const suffix = Date.now().toString();
  await page.goto('/create-shop');
  await page.getByLabel('Your name', { exact: true }).fill('Hana');
  await page.getByLabel('Shop name', { exact: true }).fill(`Hana Studio ${suffix}`);
  await page.getByLabel('Email address').fill(`hana-${suffix}@example.com`);
  await page.getByLabel('Password').fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  await expect(page).toHaveURL(/overview/);
  await page.goto('/programme');
  await page.getByLabel('The little reward').fill('One finishing treatment');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeEnabled();
  await page.getByLabel('The little reward').fill('One standard trim');
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeEnabled();
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await page.getByRole('button', { name: 'Publish programme', exact: true }).click();
  await expect(page.getByLabel('The little reward')).toBeDisabled();
  await expect(page.getByText('Published programme', { exact: true })).toBeVisible();
  const data = await (await page.request.get(`api/public/shop/hana-studio-${suffix}`)).json();
  expect(data.programme.reward_description).toBe('One standard trim');
  const others = await page.request.get('/api/membership?id=demo-member-0');
  expect(others.status()).toBe(403);
});

test('camera denial has a manual fallback and dialogs restore keyboard focus', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore demo workspace' }).click();
  await expect(page).toHaveURL(/overview/);
  await page.goto('/cashier');
  await page.getByRole('button', { name: 'Scan customer card' }).click();
  await expect(page.getByText(/Camera access is unavailable/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Scan customer card' })).toBeFocused();
  await page.getByLabel('Member code').fill('NQ-DEMO0001');
  await page.getByRole('button', { name: 'Find card', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Laila Idrissi', exact: true })).toBeVisible();
  const invalid = await page.request.post('/api/purchases', {
    headers: { Origin: 'https://another-site.example' },
    data: {
      membershipId: 'demo-member-0',
      idempotencyKey: 'cross-origin-attempt',
      qualifies: true,
    },
  });
  expect(invalid.status()).toBe(403);
  const result = await page.request.get('/api/export?days=30');
  expect(result.status()).toBe(200);
  expect(result.headers()['content-type']).toContain('text/csv');
});

test('desktop and mobile pages render without page errors or horizontal overflow', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Turn a visit/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/landing-desktop.png', fullPage: true });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore demo workspace' }).click();
  await expect(page.getByRole('heading', { name: /regulars/ })).toBeVisible();
  await expect(page.getByText('Your members', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  for (const route of ['/customers', '/activity', '/programme', '/cashier', '/settings']) {
    await page.goto(route);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of ['/', '/join/morrow', '/cashier', '/settings']) {
    await page.goto(route);
    await expect(page.locator('main h1')).toBeVisible();
    const overflowing = await page.evaluate(() =>
      Array.from(document.querySelectorAll('body *'))
        .filter(
          (element) =>
            element.getBoundingClientRect().right > innerWidth + 1 &&
            !element.closest('.table-wrap'),
        )
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          right: Math.round(element.getBoundingClientRect().right),
        })),
    );
    expect(overflowing, route).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      route,
    ).toBe(true);
  }
  await page.goto('/join/morrow');
  await page.screenshot({ path: 'test-results/join-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});

test('lost purchase response keeps the confirmation open and retry adds only one stamp', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Explore demo workspace' }).click();
  await expect(page).toHaveURL(/overview/);
  const before = await (await page.request.get('/api/membership?code=NQ-DEMO0002')).json();
  await page.goto('/cashier?member=NQ-DEMO0002');
  await expect(page.getByRole('heading', { name: 'Youssef Amrani', exact: true })).toBeVisible();
  let interrupted = false;
  await page.route('**/api/purchases', async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByLabel('Purchase amount (MAD)').fill('25');
  await page.getByRole('button', { name: 'Review purchase' }).click();
  await page.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
  await expect(page.getByText('Purchase recorded', { exact: true })).toBeVisible();
  const after = await (await page.request.get('/api/membership?code=NQ-DEMO0002')).json();
  expect(after.totalStamps).toBe(before.totalStamps + 1);
});
