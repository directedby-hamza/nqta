import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Database } from '../../src/server/db/client';
import { fixture } from './fixture';
import { GET, POST } from '../../src/app/api/[...path]/route';
const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock('../../src/server/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/server/db/client')>()),
  getDatabase: async () => state.db!,
}));
beforeAll(async () => {
  state.db = await fixture();
});
afterAll(async () => {
  await state.db?.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function request(path: string, body?: unknown) {
  vi.stubEnv('APP_URL', 'https://loyalty.example.org');
  return new NextRequest(`https://loyalty.example.org/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { origin: 'https://loyalty.example.org', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const context = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
it('loads public runtime configuration without depending on a seeded Morrow shop', async () => {
  const response = await GET(request('public/config'), context('public/config'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ isDemo: true, hostedTest: false });
});
it('returns a generic password-reset response for an unknown account', async () => {
  const response = await POST(
    request('auth/staff/request-reset', { email: 'nobody@example.org' }),
    context('auth/staff/request-reset'),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
it('returns Retry-After and 429 for an exhausted persistent recovery limit', async () => {
  let response: Response;
  for (let i = 0; i < 4; i++)
    response = await POST(
      request('auth/staff/request-reset', { email: 'limited@example.org' }),
      context('auth/staff/request-reset'),
    );
  expect(response!.status).toBe(429);
  expect(Number(response!.headers.get('retry-after'))).toBeGreaterThan(0);
});
it('creates no authenticated live session until the merchant verifies an email link', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('EMAIL_PROVIDER', 'resend');
  vi.stubEnv('EMAIL_FROM', 'Nqta <accounts@loyalty.example.org>');
  vi.stubEnv('RESEND_API_KEY', 're_fixture');
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify({ id: 'email-queued' }), { status: 200 }),
  );
  const response = await POST(
    request('auth/create-workspace', {
      name: 'Hana',
      email: 'hana@example.org',
      password: 'CorrectPassword123!',
      shopName: 'Hana Studio',
      slug: 'hana-studio',
      category: 'Beauty',
      location: 'Rabat, Morocco',
    }),
    context('auth/create-workspace'),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(await response.json()).toMatchObject({ verificationRequired: true });
});
