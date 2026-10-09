import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Database } from '../../src/server/db/client';
import { fixture } from './fixture';
import { GET, POST } from '../../src/app/api/[...path]/route';

const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock('../../src/server/db/client', async (original) => ({
  ...(await original<typeof import('../../src/server/db/client')>()),
  getDatabase: async () => state.db!,
}));
beforeAll(async () => {
  state.db = await fixture();
  await state.db.query('UPDATE shops SET privacy_notice=$1,privacy_contact=$2', [
    'Loyalty data is used to operate this shop’s programme.',
    'privacy@example.org',
  ]);
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
  vi.unstubAllGlobals();
});
const password = 'CustomerPassword123!';
const context = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
function request(
  path: string,
  body?: unknown,
  cookie = '',
  origin = 'https://loyalty.example.org',
) {
  return new NextRequest(`https://loyalty.example.org/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { origin, 'content-type': 'application/json', cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function post(path: string, body: unknown, cookie = '') {
  return POST(request(path, body, cookie), context(path));
}
async function get(path: string, cookie = '') {
  return GET(request(path, undefined, cookie), context(path));
}
function cookie(response: Response) {
  return (response.headers.get('set-cookie') || '').split(';')[0];
}

it('creates a phone account with a 90-day secure cookie and no recovery bundle or provider request', async () => {
  const provider = vi.fn();
  vi.stubGlobal('fetch', provider);
  const result = await post('auth/customer/register', { phone: '0612345601', password });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ ok: true });
  const header = result.headers.get('set-cookie')!;
  expect(header).toMatch(/HttpOnly/);
  expect(header).toMatch(/Secure/);
  expect(header).toMatch(/SameSite=lax/i);
  expect(header).toContain('Max-Age=7776000');
  expect(await (await get('auth/customer/account', cookie(result))).json()).toEqual({
    loginPhone: '+212612345601',
  });
  expect(provider).not.toHaveBeenCalled();
});

it('accepts phone-only shop contacts and recognises the same card without writing another enrolment', async () => {
  const reg = await post('auth/customer/register', { phone: '0612345602', password });
  const customerCookie = cookie(reg);
  const member = await post(
    'join',
    {
      programmeId: 'programme',
      name: '',
      contacts: { phone: '+212612345602' },
      consents: { sms: false, whatsapp: false },
    },
    customerCookie,
  );
  expect(member.status).toBe(200);
  const { id } = await member.json();
  const before = (await state.db!.query('SELECT id FROM memberships')).rows.length;
  const shop = (
    await state.db!.query<{ slug: string }>('SELECT slug FROM shops WHERE id=$1', ['shop'])
  ).rows[0].slug;
  expect(await (await get(`customer/shop/${shop}`, customerCookie)).json()).toMatchObject({
    membershipId: id,
    loginPhone: '+212612345602',
  });
  expect(await (await get('customer/shop/new-unjoined-shop', customerCookie)).json()).toMatchObject(
    { membershipId: null },
  );
  expect((await state.db!.query('SELECT id FROM memberships')).rows).toHaveLength(before);
  const stored = (
    await state.db!.query('SELECT contact_email,contact_phone FROM memberships WHERE id=$1', [id])
  ).rows[0];
  expect(stored).toMatchObject({ contact_email: null, contact_phone: '+212612345602' });
  expect((await get(`customer/shop/${shop}`)).status).toBe(401);
  const signIn = await post('auth/customer/sign-in', { phone: '+212612345602', password });
  expect(signIn.status).toBe(200);
  expect(await (await get(`customer/shop/${shop}`, cookie(signIn))).json()).toMatchObject({
    membershipId: id,
  });
});

it('uses safe duplicate errors and requires passwords for phone login and legacy alias adoption', async () => {
  const existing = await post('auth/customer/register', { phone: '0612345603', password });
  expect(existing.status).toBe(200);
  const duplicate = await post('auth/customer/register', { phone: '+212612345603', password });
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error).toMatch(/unavailable/i);
  expect(duplicate.headers.get('set-cookie')).toBeNull();
  expect(
    (await post('auth/customer/sign-in', { phone: '0612345603', password: 'WrongPassword123!' }))
      .status,
  ).toBe(401);
  const legacy = await post('auth/customer/register', { password });
  expect(legacy.status).toBe(200);
  const legacyCookie = cookie(legacy);
  expect(await (await get('auth/customer/account', legacyCookie)).json()).toEqual({
    loginPhone: null,
  });
  expect(
    (
      await post(
        'auth/customer/login-phone',
        { phone: '0612345604', password: 'WrongPassword123!' },
        legacyCookie,
      )
    ).status,
  ).toBe(401);
  expect(
    (await post('auth/customer/login-phone', { phone: '0612345603', password }, legacyCookie))
      .status,
  ).toBe(409);
  expect(
    (await post('auth/customer/login-phone', { phone: '0612345604', password }, legacyCookie))
      .status,
  ).toBe(200);
  expect((await post('auth/customer/sign-in', { phone: '0612345604', password })).status).toBe(200);
  expect((await post('auth/customer/login-phone', { phone: '0612345605', password })).status).toBe(
    401,
  );
});

it('rejects foreign-origin phone alias changes and disables phone endpoints in contact mode', async () => {
  const path = 'auth/customer/login-phone';
  expect(
    (
      await POST(
        request(path, { phone: '0612345606', password }, '', 'https://evil.example.org'),
        context(path),
      )
    ).status,
  ).toBe(403);
  vi.stubEnv('AUTH_MODE', 'verified-contact');
  expect((await get('auth/customer/account')).status).toBe(404);
  expect((await post(path, { phone: '0612345606', password })).status).toBe(404);
});
