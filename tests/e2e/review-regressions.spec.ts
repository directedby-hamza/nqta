import { expect, test, type Page } from '@playwright/test';
const origin = 'http://127.0.0.1:3000';
async function workspace(page: Page) {
  const slug = `review-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await page.request.post('/api/auth/create-workspace', {
    headers: { Origin: origin },
    data: {
      name: 'Review Owner',
      shopName: 'Review Studio',
      slug,
      category: 'Salon',
      email: `${slug}@example.com`,
      password: 'StrongPassword123!',
    },
  });
  expect(response.ok()).toBe(true);
  return slug;
}
test('programme fields cannot change while a saved snapshot is pending', async ({ page }) => {
  await workspace(page);
  await page.goto('/programme');
  await page.getByLabel('The little reward').fill('Reviewed treatment');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saved!: () => void;
  const started = new Promise<void>((resolve) => {
    saved = resolve;
  });
  await page.route('**/api/programme/draft', async (route) => {
    const response = await route.fetch();
    saved();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await started;
  try {
    await expect(page.getByLabel('The little reward')).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeEnabled();
});
test('publication rejects a draft changed in another tab after review', async ({
  page,
  context,
}) => {
  await workspace(page);
  await page.goto('/programme');
  await page.getByLabel('The little reward').fill('Reviewed treatment');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeEnabled();
  await page.getByRole('button', { name: 'Review & publish' }).click();
  const other = await context.newPage();
  await other.goto('/programme');
  await other.getByLabel('The little reward').fill('Changed treatment');
  await other.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(other.getByText('Draft saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish programme', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText(/changed|review/i);
  expect((await (await page.request.get('/api/workspace')).json()).programme.status).toBe('draft');
});
test('an uncertain fractional purchase survives closing and refreshing without earning twice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.getByLabel('Purchase amount (MAD)').fill('25.50');
  await page.getByRole('button', { name: 'Review purchase' }).click();
  await page.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume pending confirmation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Resume pending confirmation' }).click();
  await expect(page.getByRole('dialog')).toContainText('25.50');
  await page.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
  await expect(page.getByText('Purchase recorded', { exact: true })).toBeVisible();
  const after = await (await page.request.get('/api/membership?code=NQ-DEMO0002')).json();
  expect(after.totalStamps).toBe(before.totalStamps + 1);
  await expect(page.getByRole('button', { name: 'Resume pending confirmation' })).toHaveCount(0);
});
test('an uncertain redemption restores the original result after refresh', async ({ page }) => {
  await workspace(page);
  const draft = await (
    await page.request.post('/api/programme/draft', {
      headers: { Origin: origin },
      data: {
        threshold: 1,
        rewardDescription: 'One treatment',
        eligibility: 'Paid treatment',
        terms: 'No expiry',
      },
    })
  ).json();
  await page.request.post('/api/programme/publish', { headers: { Origin: origin }, data: draft });
  const phone = `+2126${String(Date.now()).slice(-8)}`;
  const otp = await (
    await page.request.post('/api/auth/customer/request', {
      headers: { Origin: origin },
      data: { phone },
    })
  ).json();
  await page.request.post('/api/auth/customer/verify', {
    headers: { Origin: origin },
    data: { challengeId: otp.challengeId, code: otp.developmentCode },
  });
  const member = await (
    await page.request.post('/api/join', {
      headers: { Origin: origin },
      data: {
        programmeId: draft.id,
        name: 'Reward Customer',
        consents: { sms: false, whatsapp: false },
      },
    })
  ).json();
  await page.request.post('/api/purchases', {
    headers: { Origin: origin },
    data: { membershipId: member.id, qualifies: true, idempotencyKey: `earn-${Date.now()}` },
  });
  const card = await (await page.request.get(`/api/card/${member.id}`)).json();
  const reward = card.rewards[0];
  const challenge = await (
    await page.request.post('/api/challenge', {
      headers: { Origin: origin },
      data: { rewardId: reward.id },
    })
  ).json();
  await page.goto(`/cashier?member=${card.memberCode}`);
  await page.getByRole('button', { name: 'Redeem reward', exact: true }).click();
  await page.getByLabel('Customer confirmation code').fill(challenge.code);
  let interrupted = false;
  await page.route('**/api/rewards/redeem', async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume pending confirmation' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume pending confirmation' }).click();
  await page.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  await expect(page.getByText('Reward redeemed', { exact: true })).toBeVisible();
  const activity = await (await page.request.get('/api/activity')).json();
  expect(
    activity.filter(
      (item: { membershipId: string; kind: string }) =>
        item.membershipId === member.id && item.kind === 'redemption',
    ),
  ).toHaveLength(1);
});

test('an unclassified server error keeps the purchase key until a confirmed result', async ({
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
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Connection terminated unexpectedly' }),
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Review purchase' }).click();
  await page.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Connection terminated unexpectedly',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume pending confirmation' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Resume pending confirmation' }).click();
  await page.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
  await expect(page.getByText('Purchase recorded', { exact: true })).toBeVisible();
  expect(
    (await (await page.request.get('/api/membership?code=NQ-DEMO0002')).json()).totalStamps,
  ).toBe(before.totalStamps + 1);
});
test('the exact invitation link opens on the trusted origin and creates an individual account', async ({
  page,
  browser,
}) => {
  await workspace(page);
  const email = `invite-${Date.now()}@example.com`;
  const response = await page.request.post('/api/staff/invite', {
    headers: { Origin: origin },
    data: { name: 'Sara', email, role: 'cashier' },
  });
  const { url } = await response.json();
  expect(new URL(url).origin).toBe(origin);
  const context = await browser.newContext();
  const invitee = await context.newPage();
  await invitee.goto(url);
  await invitee.getByLabel('Password').fill('NewPassword123!');
  await invitee
    .getByRole('button', { name: /Accept invitation|Join the team|Create my account/ })
    .click();
  await expect(invitee.getByText(/Your staff account is ready/)).toBeVisible();
  await context.close();
});
test('a paused shop still exposes verification for recovering an existing card', async ({
  page,
}) => {
  const slug = await workspace(page);
  const draftResponse = await page.request.post('/api/programme/draft', {
    headers: { Origin: origin },
    data: {
      threshold: 1,
      rewardDescription: 'One treatment',
      eligibility: 'Paid treatment',
      terms: 'No expiry',
    },
  });
  const draft = await draftResponse.json();
  await page.request.post('/api/programme/publish', { headers: { Origin: origin }, data: draft });
  await page.request.post('/api/shop/pause', {
    headers: { Origin: origin },
    data: { paused: true },
  });
  await page.goto(`/join/${slug}`);
  await expect(page.getByLabel('Phone number')).toBeVisible();
  await expect(page.getByText(/Existing cards can still be recovered/)).toBeVisible();
});
