import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Database } from '../../src/server/db/client';
import { fixture, owner } from './fixture';
import { GET, PATCH, POST } from '../../src/app/api/[...path]/route';
import { createCustomerService } from '../../src/server/auth/customer';
import { createPrivacyService } from '../../src/server/privacy/service';
import { readMembership } from '../../src/server/loyalty/membership';
import { hashToken, id, token } from '../../src/server/auth/crypto';

const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock('../../src/server/db/client', async (original) => ({
  ...(await original<typeof import('../../src/server/db/client')>()),
  getDatabase: async () => state.db!,
}));
let nextPhone = 700;
beforeAll(async () => {
  state.db = await fixture();
  await state.db.query('UPDATE shops SET privacy_notice=$1,privacy_contact=$2', [
    'We use declared customer details to run loyalty and send optional email newsletters.',
    'privacy@example.org',
  ]);
  await state.db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('newsletter-other','other',5,'Reward','Paid receipt','published')",
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
afterEach(() => vi.unstubAllEnvs());

async function api(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, cookie = '') {
  const request = new NextRequest(`https://loyalty.example.org/api/${path}`, {
    method,
    headers: { origin: 'https://loyalty.example.org', 'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const context = { params: Promise.resolve({ path: path.split('/') }) };
  return { GET, POST, PATCH }[method](request, context);
}
async function account() {
  const phone = `+212600000${nextPhone++}`;
  const response = await api('POST', 'auth/customer/register', {
    phone,
    password: 'PrivateCustomerPassword123!',
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const customerId = (
    await state.db!.query<{ customer_id: string }>(
      'SELECT customer_id FROM customer_credentials WHERE login_phone=$1',
      [phone],
    )
  ).rows[0].customer_id;
  return { cookie, customerId, phone };
}
function signup(phone: string, emailConsent?: boolean, programmeId = 'programme') {
  return {
    programmeId,
    profile: { fullName: '  Mina El Amrani  ', phone, email: ' Mina@Example.ORG ' },
    consents: {
      sms: false,
      whatsapp: false,
      ...(emailConsent === undefined ? {} : { email: emailConsent }),
    },
  };
}
async function latestEmailConsent(membershipId: string) {
  return (
    await state.db!.query<{ opted_in: boolean; wording_version: string; created_at: Date }>(
      "SELECT opted_in,wording_version,created_at FROM consents WHERE membership_id=$1 AND channel='email' ORDER BY sequence DESC LIMIT 1",
      [membershipId],
    )
  ).rows[0];
}

it('stores the required modern profile while email newsletters default to an explicit refusal', async () => {
  const person = await account();
  const response = await api('POST', 'join', signup(person.phone), person.cookie);
  expect(response.status).toBe(200);
  const { id } = await response.json();
  expect(
    (
      await state.db!.query(
        'SELECT c.name,c.phone,m.contact_phone,m.contact_email FROM memberships m JOIN customers c ON c.id=m.customer_id WHERE m.id=$1',
        [id],
      )
    ).rows[0],
  ).toEqual({
    name: 'Mina El Amrani',
    phone: null,
    contact_phone: person.phone,
    contact_email: 'mina@example.org',
  });
  const consent = await latestEmailConsent(id);
  expect(consent).toMatchObject({ opted_in: false, wording_version: 'email-newsletter-1.0' });
  const card = await (await api('GET', `card/${id}`, undefined, person.cookie)).json();
  expect(card.consents).toEqual({ sms: false, whatsapp: false });
  expect(card.newsletter).toEqual({
    email: 'mina@example.org',
    optedIn: false,
    updatedAt: new Date(consent.created_at).toISOString(),
  });
  expect(await readMembership(state.db!, id, { shopId: 'shop' })).not.toHaveProperty('newsletter');
});

it.each(['fullName', 'phone', 'email'] as const)(
  'requires modern profile %s before enrolment',
  async (field) => {
    const person = await account();
    const input = signup(person.phone);
    delete (input.profile as Partial<typeof input.profile>)[field];
    expect((await api('POST', 'join', input, person.cookie)).status).toBe(400);
    expect(
      (
        await state.db!.query('SELECT id FROM memberships WHERE customer_id=$1', [
          person.customerId,
        ])
      ).rows,
    ).toHaveLength(0);
  },
);

it.each([
  { fullName: '   ' },
  { fullName: 'x'.repeat(101) },
  { email: '' },
  { email: 'not-an-email' },
  { email: 'mina@example.org\nBcc: other@example.org' },
  { phone: 'invalid-phone' },
])('rejects malformed modern profile values: %j', async (change) => {
  const person = await account();
  const input = signup(person.phone);
  Object.assign(input.profile, change);
  expect((await api('POST', 'join', input, person.cookie)).status).toBe(400);
  expect(
    (await state.db!.query('SELECT id FROM memberships WHERE customer_id=$1', [person.customerId]))
      .rows,
  ).toHaveLength(0);
});

it('supports a single-word full name and records explicit email permission without granting phone contact', async () => {
  const person = await account();
  const input = signup(person.phone, true);
  input.profile.fullName = 'Mina';
  const response = await api('POST', 'join', input, person.cookie);
  expect(response.status).toBe(200);
  const { id } = await response.json();
  expect(await latestEmailConsent(id)).toMatchObject({
    opted_in: true,
    wording_version: 'email-newsletter-1.0',
  });
  const card = await createCustomerService(state.db!).getCard(person.customerId, id);
  expect(card.name).toBe('Mina');
  expect(card.newsletter).toMatchObject({ email: 'mina@example.org', optedIn: true });
  expect(card.consents).toEqual({ sms: false, whatsapp: false });
});

it('preserves legacy joins, treats missing old email permission as false, and rejects permission without an email', async () => {
  const person = await account();
  const input = { programmeId: 'programme', name: '', consents: { sms: false, whatsapp: false } };
  expect(
    (
      await api(
        'POST',
        'join',
        { ...input, consents: { ...input.consents, email: true } },
        person.cookie,
      )
    ).status,
  ).toBe(400);
  expect(
    (await state.db!.query('SELECT id FROM memberships WHERE customer_id=$1', [person.customerId]))
      .rows,
  ).toHaveLength(0);
  const response = await api('POST', 'join', input, person.cookie);
  expect(response.status).toBe(200);
  const { id } = await response.json();
  await state.db!.query("DELETE FROM consents WHERE membership_id=$1 AND channel='email'", [id]);
  expect(
    (await createCustomerService(state.db!).getCard(person.customerId, id)).newsletter,
  ).toEqual({ email: null, optedIn: false, updatedAt: null });
  expect(
    (
      await api(
        'PATCH',
        'preferences',
        { membershipId: id, consents: { sms: false, whatsapp: false, email: true } },
        person.cookie,
      )
    ).status,
  ).toBe(400);
  expect(await latestEmailConsent(id)).toBeUndefined();
});

it('reuses an existing card without replacing its name, contacts or email permission', async () => {
  const person = await account();
  const initial = await api('POST', 'join', signup(person.phone, true), person.cookie);
  const member = await initial.json();
  const before = await latestEmailConsent(member.id);
  const repeat = signup(person.phone, false);
  repeat.profile.fullName = 'Replacement Customer';
  repeat.profile.email = 'replacement@example.org';
  const recovered = await api('POST', 'join', repeat, person.cookie);
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual(member);
  expect(
    await createCustomerService(state.db!).getCard(person.customerId, member.id),
  ).toMatchObject({
    name: 'Mina El Amrani',
    newsletter: { email: 'mina@example.org', optedIn: true },
  });
  expect(await latestEmailConsent(member.id)).toEqual(before);
  expect(
    (
      await state.db!.query("SELECT id FROM consents WHERE membership_id=$1 AND channel='email'", [
        member.id,
      ])
    ).rows,
  ).toHaveLength(1);
});

it('changes only this shop email choice, preserves it during legacy preference updates, and enforces ownership', async () => {
  const person = await account();
  const stranger = await account();
  const first = await (await api('POST', 'join', signup(person.phone, true), person.cookie)).json();
  const other = await (
    await api('POST', 'join', signup(person.phone, true, 'newsletter-other'), person.cookie)
  ).json();
  const before = await latestEmailConsent(first.id);
  const update = { membershipId: first.id, consents: { sms: false, whatsapp: false } };
  expect((await api('PATCH', 'preferences', update, person.cookie)).status).toBe(200);
  expect(await latestEmailConsent(first.id)).toEqual(before);
  expect(
    (
      await api(
        'PATCH',
        'preferences',
        { ...update, consents: { ...update.consents, email: false } },
        stranger.cookie,
      )
    ).status,
  ).toBe(403);
  expect((await api('GET', `card/${first.id}`, undefined, stranger.cookie)).status).toBe(403);
  expect(await latestEmailConsent(first.id)).toEqual(before);
  expect(
    (
      await api(
        'PATCH',
        'preferences',
        { ...update, consents: { ...update.consents, email: false } },
        person.cookie,
      )
    ).status,
  ).toBe(200);
  const after = await latestEmailConsent(first.id);
  expect(after).toMatchObject({ opted_in: false, wording_version: 'email-newsletter-1.0' });
  expect(new Date(after.created_at).getTime()).toBeGreaterThanOrEqual(
    new Date(before.created_at).getTime(),
  );
  expect(
    (
      await state.db!.query(
        "SELECT opted_in FROM consents WHERE membership_id=$1 AND channel='email' ORDER BY sequence",
        [first.id],
      )
    ).rows,
  ).toEqual([{ opted_in: true }, { opted_in: false }]);
  expect(
    (await createCustomerService(state.db!).getCard(person.customerId, first.id)).newsletter,
  ).toMatchObject({ optedIn: false, updatedAt: new Date(after.created_at).toISOString() });
  expect(
    (await createCustomerService(state.db!).getCard(person.customerId, other.id)).newsletter,
  ).toMatchObject({ optedIn: true });
});

it('withdraws email permission and clears contact details on fulfilled shop deletion while preserving another shop', async () => {
  const person = await account();
  const first = await (await api('POST', 'join', signup(person.phone, true), person.cookie)).json();
  const other = await (
    await api('POST', 'join', signup(person.phone, true, 'newsletter-other'), person.cookie)
  ).json();
  const customers = createCustomerService(state.db!);
  await customers.requestDeletion(person.customerId, first.id);
  const request = (
    await state.db!.query<{ id: string }>(
      "SELECT id FROM support_requests WHERE membership_id=$1 AND kind='deletion'",
      [first.id],
    )
  ).rows[0];
  await createPrivacyService(state.db!).fulfilDeletion(
    owner,
    request.id,
    'Remove this shop membership as requested.',
  );
  expect(
    (
      await state.db!.query(
        'SELECT status,contact_phone,contact_email FROM memberships WHERE id=$1',
        [first.id],
      )
    ).rows[0],
  ).toEqual({ status: 'closed', contact_phone: null, contact_email: null });
  expect(await latestEmailConsent(first.id)).toMatchObject({
    opted_in: false,
    wording_version: 'email-newsletter-1.0',
  });
  expect((await customers.getCard(person.customerId, other.id)).newsletter).toMatchObject({
    email: 'mina@example.org',
    optedIn: true,
  });
  await expect(
    customers.updatePreferences(person.customerId, first.id, {
      sms: false,
      whatsapp: false,
      email: true,
    }),
  ).rejects.toThrow(/not found|access/i);
});

it('exports only opted-in recipients through an authenticated owner CSV response and denies cashiers and anonymous callers', async () => {
  const person = await account();
  const email = `newsletter-api-${person.phone.slice(-3)}@example.org`;
  const input = signup(person.phone, false);
  input.profile.fullName = 'API Newsletter Customer';
  input.profile.email = email;
  const joined = await api('POST', 'join', input, person.cookie);
  expect(joined.status).toBe(200);
  const member = await joined.json();
  // Real database staff principals and hashed random sessions exercise the API's
  // actor lookup and owner check rather than replacing either authorization layer.
  await state.db!.query(
    "UPDATE staff SET auth_method='recovery-key' WHERE id IN('owner','cashier')",
  );
  async function staffCookie(staffId: string) {
    const sessionToken = token();
    await state.db!.query(
      "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,$3,'staff',NOW()+interval '7 days')",
      [id(), hashToken(sessionToken), staffId],
    );
    return `nqta_staff=${sessionToken}`;
  }
  const ownerCookie = await staffCookie('owner');
  const cashierCookie = await staffCookie('cashier');
  const path = 'customers/newsletter-export';
  const anonymous = await api('GET', path);
  expect(anonymous.status).toBe(401);
  const anonymousBody = await anonymous.text();
  expect(anonymousBody).not.toContain(email);
  expect(anonymousBody).not.toContain(person.phone);
  expect(anonymousBody).not.toContain(input.profile.fullName);
  const cashier = await api('GET', path, undefined, cashierCookie);
  expect(cashier.status).toBe(403);
  const cashierBody = await cashier.text();
  expect(cashierBody).not.toContain(email);
  expect(cashierBody).not.toContain(person.phone);
  expect(cashierBody).not.toContain(input.profile.fullName);
  const before = await api('GET', path, undefined, ownerCookie);
  expect(before.status).toBe(200);
  expect(await before.text()).not.toContain(email);
  const preferences = {
    membershipId: member.id,
    consents: { sms: false, whatsapp: false, email: true },
  };
  expect((await api('PATCH', 'preferences', preferences, person.cookie)).status).toBe(200);
  const accepted = await api('GET', path, undefined, ownerCookie);
  expect(accepted.status).toBe(200);
  expect(accepted.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  expect(accepted.headers.get('content-disposition')).toBe(
    'attachment; filename="nqta-newsletter.csv"',
  );
  expect(accepted.headers.get('cache-control')).toBe('no-store');
  const csv = await accepted.text();
  expect(csv.startsWith('"full_name","email","phone","consent_updated_at"')).toBe(true);
  expect(csv).toContain(`"API Newsletter Customer","${email}"`);
  expect(csv).toContain(person.phone);
  preferences.consents.email = false;
  expect((await api('PATCH', 'preferences', preferences, person.cookie)).status).toBe(200);
  const withdrawn = await api('GET', path, undefined, ownerCookie);
  expect(withdrawn.status).toBe(200);
  expect(await withdrawn.text()).not.toContain(email);
});
