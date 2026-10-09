import { randomInt } from 'node:crypto';
import { expect, test, type Download, type Page } from '@playwright/test';
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';

test.skip(process.env.AUTH_MODE !== 'recovery-key', 'Uses phone and password accounts.');

const password = 'SimpleCustomerPassword123!';
function phone() {
  return `06${randomInt(10000000, 100000000)}`;
}

async function createCard(page: Page, loginPhone: string, name?: string) {
  await page.goto('/join/morrow');
  await page.getByLabel('Phone number', { exact: true }).fill(loginPhone);
  await page.getByLabel('Password', { exact: true }).fill(password);
  if (name) {
    await page.getByText('Your details (optional)', { exact: true }).click();
    await page.getByLabel('First name').fill(name);
  }
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page).toHaveURL(/\/card\/[^/?]+/);
  await expect(page.getByRole('region', { name: 'Your checkout QR' })).toBeVisible();
  const membershipId = new URL(page.url()).pathname.split('/').pop()!;
  const response = await page.request.get(`/api/card/${membershipId}`);
  expect(response.ok()).toBe(true);
  return { membershipId, card: await response.json() };
}

async function signIn(page: Page, loginPhone: string, value = password) {
  await page.getByRole('button', { name: 'Sign in to my account', exact: true }).click();
  await page.getByLabel('Phone number or account ID', { exact: true }).fill(loginPhone);
  await page.getByLabel('Password', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Sign in and open my card', exact: true }).click();
}

async function decodeDownloadedQR(page: Page, download: Download) {
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  const image = await page.evaluate(
    async (source) => {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Could not load downloaded PNG'));
        image.src = source;
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(90, 212, 620, 620).data;
      const luminances: number[] = [];
      for (let offset = 0; offset < pixels.length; offset += 4)
        luminances.push((pixels[offset] + pixels[offset + 1] * 2 + pixels[offset + 2]) / 4);
      return { width: image.naturalWidth, height: image.naturalHeight, luminances };
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
  expect({ width: image.width, height: image.height }).toEqual({ width: 800, height: 1040 });
  const bitmap = new BinaryBitmap(
    new HybridBinarizer(new RGBLuminanceSource(Uint8ClampedArray.from(image.luminances), 620, 620)),
  );
  return new QRCodeReader()
    .decode(bitmap, new Map([[DecodeHintType.PURE_BARCODE, true]]))
    .getText();
}

test('mobile signup opens the QR directly and the same browser finds it on the next visit', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const loginPhone = phone();
  const { membershipId, card } = await createCard(page, loginPhone);
  expect(card.memberCode).toMatch(/^NQ-[A-F0-9]{16}$/);
  expect(card.totalStamps).toBe(0);
  expect(card.consents).toEqual({ sms: false, whatsapp: false });
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('I have saved my account ID and recovery key')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Wallet|Download recovery details/ })).toHaveCount(
    0,
  );
  const qr = page.getByRole('region', { name: 'Your checkout QR' });
  await expect(qr.locator('code')).toHaveText(card.memberCode);
  const qrBounds = await qr.boundingBox();
  const progressBounds = await page.getByTestId('stamp-progress').boundingBox();
  expect(qrBounds!.y).toBeLessThan(progressBounds!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored.includes(password)).toBe(false);
  expect(stored.includes(loginPhone)).toBe(false);
  const lookup = await page.request.get('/api/customer/shop/morrow');
  expect(lookup.ok()).toBe(true);
  expect(await lookup.json()).toEqual({
    membershipId,
    loginPhone: `+212${loginPhone.slice(1)}`,
  });
  expect(await (await page.request.get('/api/customer/shop/no-such-shop')).json()).toEqual({
    membershipId: null,
    loginPhone: `+212${loginPhone.slice(1)}`,
  });

  let enrollments = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/join') && request.method() === 'POST') enrollments++;
  });
  await page.goto('/join/morrow');
  await expect(page).toHaveURL(new RegExp(`/card/${membershipId}(?:\\?|$)`));
  await expect(page.getByRole('region', { name: 'Your checkout QR' }).locator('code')).toHaveText(
    card.memberCode,
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  expect(enrollments).toBe(0);

  await page.getByRole('button', { name: 'Add to home screen', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Your card, one tap away.' });
  await expect(help.getByRole('heading', { name: 'iPhone · Safari', exact: true })).toBeVisible();
  await expect(
    help.getByText('Tap Share, then Add to Home Screen.', { exact: true }),
  ).toBeVisible();
  await expect(help.getByRole('heading', { name: 'Android · Chrome', exact: true })).toBeVisible();
  await help.getByRole('button', { name: 'Got it', exact: true }).click();

  const origin = String(testInfo.project.use.baseURL);
  const signedOut = await page.request.post('/api/auth/sign-out', {
    headers: { origin },
    data: { kind: 'customer' },
  });
  expect(signedOut.ok()).toBe(true);
  expect((await page.request.get(`/api/card/${membershipId}`)).status()).toBe(401);
  await page.goto('/join/morrow');
  await expect(page.getByRole('region', { name: 'Your checkout QR' })).toHaveCount(0);
  await signIn(page, loginPhone, 'WrongPassword123!');
  await expect(
    page.getByRole('alert').filter({ hasText: /credentials.*incorrect/i }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/join\/morrow/);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in and open my card', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/card/${membershipId}(?:\\?|$)`));
  expect(enrollments).toBe(0);
});

test('a downloaded PNG scans for checkout without customer login and a new browser requires the password', async ({
  browser,
}, testInfo) => {
  const customer = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const privateBrowser = await browser.newContext({ reducedMotion: 'reduce' });
  const merchant = await browser.newContext({ reducedMotion: 'reduce' });
  const origin = String(testInfo.project.use.baseURL);
  const loginPhone = phone();
  try {
    const page = await customer.newPage();
    const { membershipId, card } = await createCard(page, loginPhone, 'Simple QR Customer');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save QR image', exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(`nqta-${card.memberCode}.png`);
    const memberCode = await decodeDownloadedQR(page, download);
    expect(memberCode === card.memberCode).toBe(true);
    expect(memberCode).toMatch(/^NQ-[A-F0-9]{16}$/);
    await expect(page.getByRole('dialog', { name: 'Keep this QR for checkout.' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Morrow Coffee checkout QR card' })).toBeVisible();
    await expect(
      page.getByText(/touch and hold this image and choose Save to Photos/),
    ).toBeVisible();

    expect(
      (
        await customer.request.post('/api/auth/sign-out', {
          headers: { origin },
          data: { kind: 'customer' },
        })
      ).ok(),
    ).toBe(true);
    expect((await customer.request.get(`/api/card/${membershipId}`)).status()).toBe(401);
    expect((await privateBrowser.request.get(`/api/card/${membershipId}`)).status()).toBe(401);

    const cashier = await merchant.newPage();
    await cashier.goto('/sign-in');
    await cashier.getByRole('button', { name: 'Explore demo workspace', exact: true }).click();
    await expect(cashier).toHaveURL(/overview/);
    await cashier.goto(`/cashier?member=${memberCode}`);
    await expect(cashier.getByText('Simple QR Customer', { exact: true }).first()).toBeVisible();
    await cashier.getByLabel('Purchase amount (MAD)').fill('25');
    await cashier.getByRole('button', { name: 'Review purchase', exact: true }).click();
    await cashier.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
    await expect(cashier.getByText('Purchase recorded', { exact: true })).toBeVisible();
    expect(
      (
        await customer.request.post('/api/challenge', {
          headers: { origin },
          data: { rewardId: 'not-a-reward' },
        })
      ).status(),
    ).toBe(401);

    const restored = await privateBrowser.newPage();
    await restored.goto('/join/morrow');
    await expect(restored.getByRole('region', { name: 'Your checkout QR' })).toHaveCount(0);
    await signIn(restored, `+212${loginPhone.slice(1)}`);
    await expect(restored).toHaveURL(new RegExp(`/card/${membershipId}(?:\\?|$)`));
    await expect(
      restored.getByRole('region', { name: 'Your checkout QR' }).locator('code'),
    ).toHaveText(memberCode);
    await expect(restored.getByTestId('stamp-progress')).toHaveAttribute(
      'aria-label',
      '1 of 5 stamps in this cycle',
    );
    await expect(restored.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
  } finally {
    await Promise.all([customer.close(), privateBrowser.close(), merchant.close()]);
  }
});

test('invalid phone details are corrected before signup while name and email remain optional', async ({
  page,
}) => {
  let registrations = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/customer/register')) registrations++;
  });
  await page.goto('/join/morrow');
  await page.getByLabel('Phone number', { exact: true }).fill('1234');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /valid phone number/i })).toBeVisible();
  expect(registrations).toBe(0);
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('1234');
  await page.getByLabel('Phone number', { exact: true }).fill(phone());
  await page.getByRole('button', { name: 'Save my card', exact: true }).click();
  await expect(page).toHaveURL(/\/card\/[^/?]+/);
  await expect(page.getByRole('region', { name: 'Your checkout QR' })).toBeVisible();
  expect(registrations).toBe(1);
});
