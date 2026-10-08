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
function request(
  path: string,
  body?: unknown,
  origin = 'https://loyalty.example.org',
  cookie?: string,
) {
  return new NextRequest(`https://loyalty.example.org/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const context = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });

it('publishes the actual authentication mode without demo access', async () => {
  const response = await GET(request('public/config'), context('public/config'));
  expect(await response.json()).toMatchObject({ authMode: 'recovery-key', isDemo: false });
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it.each([
  ['auth/customer/request', { phone: '+212600000101' }],
  ['auth/customer/verify', { challengeId: 'unused', code: '123456' }],
  ['auth/staff/request-reset', { email: 'unknown@example.org' }],
  ['auth/staff/request-verification', { email: 'unknown@example.org' }],
  ['auth/staff/verify-email', { token: 'b'.repeat(64) }],
  ['auth/staff/reset-password', { token: 'b'.repeat(64), password: 'CorrectPassword123!' }],
])('disables the inactive contact-based route %s', async (path, body) => {
  const sent = vi.fn();
  vi.stubGlobal('fetch', sent);
  const response = await POST(request(path, body), context(path));
  expect(response.status).toBe(404);
  expect(sent).not.toHaveBeenCalled();
});
it('registers an ordinary secure customer session and exposes only its one-time recovery bundle', async () => {
  const sent = vi.fn();
  vi.stubGlobal('fetch', sent);
  const path = 'auth/customer/register';
  const response = await POST(request(path, { password: 'CorrectPassword123!' }), context(path));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data).toMatchObject({
    ok: true,
    accountId: expect.any(String),
    recoveryKey: expect.any(String),
  });
  expect(data.token).toBeUndefined();
  const cookie = response.headers.get('set-cookie') || '';
  expect(cookie).toContain('nqta_customer=');
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/Secure/);
  expect(cookie).toMatch(/SameSite=lax/i);
  expect(sent).not.toHaveBeenCalled();
});
it('rejects a foreign-origin account registration before authenticating', async () => {
  const path = 'auth/customer/register';
  const response = await POST(
    request(path, { password: 'CorrectPassword123!' }, 'https://evil.example.org'),
    context(path),
  );
  expect(response.status).toBe(403);
  expect(response.headers.get('set-cookie')).toBeNull();
});
it('does not expose password or recovery endpoints in verified-contact mode', async () => {
  vi.stubEnv('AUTH_MODE', 'verified-contact');
  const path = 'auth/customer/register';
  const response = await POST(request(path, { password: 'CorrectPassword123!' }), context(path));
  expect(response.status).toBe(404);
});

it('binds customer key replacement to the displayed account despite a shared-cookie account switch', async () => {
  const password = 'SharedCorrectPassword123!';
  const register = 'auth/customer/register';
  const first = await POST(request(register, { password }), context(register));
  const accountA = await first.json();
  const second = await POST(request(register, { password }), context(register));
  const accountB = await second.json();
  const cookieB = (second.headers.get('set-cookie') || '').split(';')[0];
  const before = (
    await state.db!.query<{ recovery_key_hash: string }>(
      'SELECT recovery_key_hash FROM customer_credentials WHERE account_id=$1',
      [accountB.accountId],
    )
  ).rows[0].recovery_key_hash;
  const rotate = 'auth/customer/rotate-recovery-key';
  const response = await POST(
    request(
      rotate,
      { password, accountId: accountA.accountId },
      'https://loyalty.example.org',
      cookieB,
    ),
    context(rotate),
  );
  expect(response.status).toBe(401);
  const after = (
    await state.db!.query<{ recovery_key_hash: string }>(
      'SELECT recovery_key_hash FROM customer_credentials WHERE account_id=$1',
      [accountB.accountId],
    )
  ).rows[0].recovery_key_hash;
  expect(before === after).toBe(true);
  expect(response.headers.get('set-cookie')).toBeNull();
});
