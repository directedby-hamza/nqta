import { expect, test, type APIRequestContext } from '@playwright/test';

test('owner saves privacy details and fulfils a customer deletion request while retaining receipt activity', async ({
  browser,
}) => {
  const origin = `http://127.0.0.1:${process.env.NQTA_E2E_PORT || 3000}`;
  const merchant = await browser.newContext();
  const customer = await browser.newContext();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
    const response = await request.post(`/api/${path}`, { headers: { origin }, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response.json() as Promise<T>;
  }
  try {
    await post(merchant.request, 'auth/create-workspace', {
      name: 'Hana',
      email: `privacy-${suffix}@example.org`,
      password: 'CorrectPassword123!',
      shopName: 'Privacy Shop',
      slug: `privacy-${suffix}`,
      category: 'Retail',
      location: 'Rabat, Morocco',
    });
    const settings = await merchant.newPage();
    await settings.goto('/settings');
    await settings.getByLabel('Customer privacy contact').fill('privacy@example.org');
    await settings
      .getByLabel('Your customer privacy notice')
      .fill('We use your phone and receipt activity for loyalty. Contact us to remove your card.');
    await settings.getByRole('button', { name: 'Save shop profile' }).click();
    await expect(settings.getByText('Your shop profile is saved', { exact: true })).toBeVisible();
    const draft = await post<{ id: string; revision: number }>(
      merchant.request,
      'programme/draft',
      {
        threshold: 5,
        rewardDescription: 'One reward',
        eligibility: 'Paid receipt',
        terms: 'Five paid receipts earn one reward.',
      },
    );
    await post(merchant.request, 'programme/publish', { id: draft.id, revision: draft.revision });
    const verification = await post<{ challengeId: string; developmentCode: string }>(
      customer.request,
      'auth/customer/request',
      {
        phone: `+2126${String(Date.now()).slice(-8)}`,
      },
    );
    await post(customer.request, 'auth/customer/verify', {
      challengeId: verification.challengeId,
      code: verification.developmentCode,
    });
    const member = await post<{ id: string }>(customer.request, 'join', {
      programmeId: draft.id,
      name: 'Mina Privacy',
      consents: { sms: true, whatsapp: false },
    });
    await post(merchant.request, 'purchases', {
      membershipId: member.id,
      idempotencyKey: `privacy-${suffix}`,
      qualifies: true,
      amountMinor: 2500,
      receiptReference: `privacy-${suffix}`,
    });
    const card = await customer.newPage();
    await card.goto(`/card/${member.id}`);
    await card.getByRole('button', { name: 'Card settings' }).click();
    await card.getByRole('button', { name: 'Request deletion of my personal data' }).click();
    await card.getByRole('button', { name: 'Confirm deletion request' }).click();
    await expect(
      card.getByText('Deletion request received. The shop owner will review it.', { exact: true }),
    ).toBeVisible();
    await settings.reload();
    await settings.getByRole('button', { name: 'Review and remove member' }).click();
    await expect(settings.getByRole('dialog')).toContainText('This action cannot be undone.');
    await settings
      .getByLabel('Decision and action taken')
      .fill(
        'Customer confirmed removal for this shop. Receipt activity retained for reconciliation.',
      );
    await settings.getByRole('button', { name: 'Confirm removal' }).click();
    await expect(
      settings.getByText('Request completed and recorded', { exact: true }),
    ).toBeVisible();
    const retained = await merchant.request.get(`/api/membership?id=${member.id}`);
    expect(retained.ok()).toBe(true);
    expect(await retained.json()).toMatchObject({
      status: 'closed',
      name: 'Removed member',
      totalStamps: 1,
    });
    expect((await customer.request.get(`/api/card/${member.id}`)).status()).toBe(401);
  } finally {
    await merchant.close();
    await customer.close();
  }
});
