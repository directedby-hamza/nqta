import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Database } from '../../src/server/db/client';
import { fixture, owner } from './fixture';
import { POST } from '../../src/app/api/[...path]/route';
import { createCustomerService } from '../../src/server/auth/customer';
import { createPrivacyService } from '../../src/server/privacy/service';

const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock('../../src/server/db/client', async (original) => ({
  ...(await original<typeof import('../../src/server/db/client')>()),
  getDatabase: async () => state.db!,
}));

beforeAll(async () => {
  state.db = await fixture();
  await state.db.query('UPDATE shops SET privacy_notice=$1,privacy_contact=$2', [
    'We use the contact details you provide and your purchases to run this loyalty programme.',
    'privacy@example.org',
  ]);
  await state.db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('other-programme','other',5,'Reward','Paid receipt','published')",
  );
});
afterAll(async () => {
  await state.db?.close();
});
beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'recovery-key');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DEMO_MODE', 'false');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('APP_URL', 'https://loyalty.example.org');
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(48));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function post(
  path: string,
  body: unknown,
  cookie?: string,
  origin = 'https://loyalty.example.org',
) {
  return POST(
    new NextRequest(`https://loyalty.example.org/api/${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: path.split('/') }) },
  );
}
async function register() {
  const response = await post('auth/customer/register', { password: 'MyPrivatePassword123!' });
  expect(response.status).toBe(200);
  const { accountId } = await response.json();
  const { customer_id: customerId } = (
    await state.db!.query<{ customer_id: string }>(
      'SELECT customer_id FROM customer_credentials WHERE account_id=$1',
      [accountId],
    )
  ).rows[0];
  return { customerId, cookie: response.headers.get('set-cookie')!.split(';')[0] };
}
const join = (contacts?: unknown, programmeId = 'programme') => ({
  programmeId,
  name: 'Mina',
  consents: { sms: false, whatsapp: false },
  ...(contacts !== undefined ? { contacts } : {}),
});
async function storedMember(id: string) {
  return (
    await state.db!.query<{ member: Record<string, unknown> }>(
      'SELECT to_jsonb(m) AS member FROM memberships m WHERE id=$1',
      [id],
    )
  ).rows[0].member;
}

it('saves normalized declared contacts on a shop membership without verifying or changing the account identity', async () => {
  const account = await register();
  const response = await post(
    'join',
    join({ phone: '+212 (600) 000-101', email: ' Mina@Example.ORG ' }),
    account.cookie,
  );
  expect(response.status).toBe(200);
  const member = await response.json();
  expect(await storedMember(member.id)).toMatchObject({
    customer_id: account.customerId,
    contact_phone: '+212600000101',
    contact_email: 'mina@example.org',
  });
  expect(
    (await state.db!.query('SELECT phone FROM customers WHERE id=$1', [account.customerId])).rows,
  ).toEqual([{ phone: null }]);
  expect((await state.db!.query('SELECT id FROM verification_challenges')).rows).toHaveLength(0);
});

it.each([
  { phone: '0600000101', email: 'mina@example.org' },
  { phone: '+212600000101', email: 'invalid-email' },
  { phone: '+212600000101', email: 'mina@example.org\nBcc: other@example.org' },
  { phone: '+212600000101' },
  { email: 'mina@example.org' },
  { phone: '+212600000101', email: `${'a'.repeat(200)}@example.org` },
])('rejects malformed contact input before creating a membership: %j', async (contacts) => {
  const account = await register();
  const response = await post('join', join(contacts), account.cookie);
  expect(response.status).toBe(400);
  expect(
    (await state.db!.query('SELECT id FROM memberships WHERE customer_id=$1', [account.customerId]))
      .rows,
  ).toHaveLength(0);
});

it('allows separate accounts to declare the same contacts without merging access to their cards', async () => {
  const first = await register();
  const second = await register();
  const contacts = { phone: '+212600000102', email: 'shared@example.org' };
  const firstResponse = await post('join', join(contacts), first.cookie);
  const secondResponse = await post('join', join(contacts), second.cookie);
  expect(firstResponse.status).toBe(200);
  expect(secondResponse.status).toBe(200);
  const firstMember = await firstResponse.json();
  const secondMember = await secondResponse.json();
  expect(firstMember.id).not.toBe(secondMember.id);
  expect(await storedMember(firstMember.id)).toMatchObject({
    customer_id: first.customerId,
    contact_phone: '+212600000102',
    contact_email: 'shared@example.org',
  });
  expect(await storedMember(secondMember.id)).toMatchObject({ customer_id: second.customerId });
  await expect(
    createCustomerService(state.db!).getCard(second.customerId, firstMember.id),
  ).rejects.toThrow(/not found|access/i);
});

it('recovers an existing membership without silently replacing its saved contact details', async () => {
  const account = await register();
  const initial = await post(
    'join',
    join({ phone: '+212600000103', email: 'original@example.org' }),
    account.cookie,
  );
  const member = await initial.json();
  const recovered = await post(
    'join',
    join({ phone: '+212600000104', email: 'replacement@example.org' }),
    account.cookie,
  );
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual(member);
  expect(await storedMember(member.id)).toMatchObject({
    contact_phone: '+212600000103',
    contact_email: 'original@example.org',
  });
});

it('keeps legacy join requests without declared contacts working', async () => {
  const account = await register();
  const response = await post('join', join(), account.cookie);
  expect(response.status).toBe(200);
  expect(await storedMember((await response.json()).id)).toMatchObject({
    contact_phone: null,
    contact_email: null,
  });
});

it('removes declared contacts from a deleted shop membership while preserving another shop membership', async () => {
  const account = await register();
  const contacts = { phone: '+212600000105', email: 'delete@example.org' };
  const first = await post('join', join(contacts), account.cookie);
  const other = await post('join', join(contacts, 'other-programme'), account.cookie);
  const member = await first.json();
  const otherMember = await other.json();
  const customers = createCustomerService(state.db!);
  await customers.requestDeletion(account.customerId, member.id);
  const request = (
    await state.db!.query<{ id: string }>(
      "SELECT id FROM support_requests WHERE membership_id=$1 AND kind='deletion'",
      [member.id],
    )
  ).rows[0];
  await createPrivacyService(state.db!).fulfilDeletion(
    owner,
    request.id,
    'Remove this shop membership as requested.',
  );
  expect(await storedMember(member.id)).toMatchObject({
    status: 'closed',
    contact_phone: null,
    contact_email: null,
  });
  expect(await storedMember(otherMember.id)).toMatchObject({
    customer_id: account.customerId,
    contact_phone: '+212600000105',
    contact_email: 'delete@example.org',
  });
  expect((await customers.getCard(account.customerId, otherMember.id)).status).toBe('active');
});

it('requires the authenticated account and trusted application origin to save declared contacts', async () => {
  const contacts = { phone: '+212600000106', email: 'auth@example.org' };
  const unauthenticated = await post('join', join(contacts));
  expect(unauthenticated.status).toBe(401);
  const account = await register();
  const foreign = await post('join', join(contacts), account.cookie, 'https://foreign.example.org');
  expect(foreign.status).toBe(403);
  expect(
    (await state.db!.query('SELECT id FROM memberships WHERE customer_id=$1', [account.customerId]))
      .rows,
  ).toHaveLength(0);
});
