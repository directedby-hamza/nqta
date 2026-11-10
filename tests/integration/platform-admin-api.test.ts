import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Database } from '../../src/server/db/client';
import { fixture } from './fixture';
import { provisionAdmin, createPlatformAuth } from '../../src/server/platform/auth';
import { createAuthService } from '../../src/server/auth/staff';
import { createPlatformBilling } from '../../src/server/platform/billing';
import { GET, POST, PATCH } from '../../src/app/api/admin/[...path]/route';
import { GET as merchantGet, POST as merchantPost } from '../../src/app/api/[...path]/route';
const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock('../../src/server/db/client', async (original) => ({
  ...(await original<typeof import('../../src/server/db/client')>()),
  getDatabase: async () => state.db!,
}));
let adminId: string;
let token: string;
let staffToken: string;
const origin = 'https://nqta.example.org';
const context = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
function request(
  path: string,
  method = 'GET',
  body?: unknown,
  cookie = '',
  requestOrigin = origin,
) {
  return new NextRequest(`${origin}/api/${path}`, {
    method,
    headers: { origin: requestOrigin, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  vi.stubEnv('APP_URL', origin);
  state.db = await fixture();
  adminId = (
    await provisionAdmin(state.db, {
      email: 'admin@nqta.local',
      name: 'Admin',
      password: 'TemporaryAdminPassword123!',
    })
  ).id;
  const auth = createPlatformAuth(state.db);
  token = await auth.changePassword(
    await auth.signIn('admin@nqta.local', 'TemporaryAdminPassword123!'),
    'TemporaryAdminPassword123!',
    'ChangedAdminPassword456!',
  );
  staffToken = await createAuthService(state.db).signInStaff(
    'owner@test.com',
    'CorrectPassword123!',
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await state.db?.close();
});
it('only the separate admin cookie authorises shop listing and responses are never cached', async () => {
  for (const cookie of ['', `nqta_staff=${staffToken}`, `nqta_admin=${staffToken}`]) {
    const r = await GET(request('admin/shops', 'GET', undefined, cookie), context('shops'));
    expect(r.status).toBe(401);
  }
  const r = await GET(
    request('admin/shops', 'GET', undefined, `nqta_admin=${token}`),
    context('shops'),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toContain('no-store');
  expect((await r.json()).total).toBe(2);
});
it('cross-origin and malformed admin writes do not change a shop', async () => {
  const body = {
    state: 'suspended',
    validUntil: null,
    reason: 'Awaiting payment',
    expectedRevision: 0,
  };
  const r = await PATCH(
    request(
      'admin/shops/shop/access',
      'PATCH',
      body,
      `nqta_admin=${token}`,
      'https://attacker.example',
    ),
    context('shops/shop/access'),
  );
  expect(r.status).toBe(403);
  const invalid = await PATCH(
    request('admin/shops/shop/access', 'PATCH', { ...body, state: 'owner' }, `nqta_admin=${token}`),
    context('shops/shop/access'),
  );
  expect(invalid.status).toBe(400);
  expect((await createPlatformBilling(state.db!).detail(adminId, 'shop')).shop.state).toBe(
    'unreviewed',
  );
});
it('admin sign-in uses a secure, HttpOnly, twelve-hour cookie and logout revokes it', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  const r = await POST(
    request('admin/auth/sign-in', 'POST', {
      email: 'admin@nqta.local',
      password: 'ChangedAdminPassword456!',
    }),
    context('auth/sign-in'),
  );
  expect(r.status).toBe(200);
  const cookie = r.headers.get('set-cookie')!;
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/Max-Age=43200/i);
  expect(cookie).toMatch(/SameSite=Strict/i);
  const pair = cookie.split(';')[0];
  expect(
    (await POST(request('admin/auth/sign-out', 'POST', {}, pair), context('auth/sign-out'))).status,
  ).toBe(200);
  expect((await GET(request('admin/me', 'GET', undefined, pair), context('me'))).status).toBe(401);
});
it('suspended staff retain only their subscription notice and cannot bypass it with a stale session', async () => {
  await createPlatformBilling(state.db!).setAccess(adminId, 'shop', {
    state: 'suspended',
    validUntil: null,
    reason: 'Payment outstanding',
    expectedRevision: 0,
  });
  const cookie = `nqta_staff=${staffToken}`;
  const workspace = await merchantGet(
    request('workspace', 'GET', undefined, cookie),
    context('workspace'),
  );
  expect(workspace.status).toBe(200);
  expect((await workspace.json()).subscription.allowed).toBe(false);
  expect(
    (await merchantGet(request('overview', 'GET', undefined, cookie), context('overview'))).status,
  ).toBe(402);
  expect(
    (
      await merchantPost(
        request(
          'purchases',
          'POST',
          { membershipId: 'x', qualifies: true, idempotencyKey: 'purchase-attempt' },
          cookie,
        ),
        context('purchases'),
      )
    ).status,
  ).toBe(402);
  const publicShop = await merchantGet(
    request('public/shop/coffee'),
    context('public/shop/coffee'),
  );
  expect((await publicShop.json()).programme).toBeNull();
});
