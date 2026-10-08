import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Database } from '../../src/server/db/client';
import { fixture } from './fixture';
import { createCustomerPasswordService } from '../../src/server/auth/customer-password';
import { GET, POST } from '../../src/app/api/[...path]/route';

const state = vi.hoisted(() => ({
  db: null as Database | null,
  available: { google: false, apple: false },
  sync: vi.fn(),
  sign: vi.fn(),
  after: vi.fn(),
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: state.after,
}));
vi.mock('../../src/server/db/client', async (original) => ({
  ...(await original<typeof import('../../src/server/db/client')>()),
  getDatabase: async () => state.db!,
}));
vi.mock('../../src/server/wallet/options', () => ({ walletOptions: () => state.available }));
vi.mock('../../src/server/wallet/google', () => ({
  googleWalletObjectId: (id: string) => '123.' + id,
  syncGoogleWalletPass: state.sync,
  googleWalletSaveUrl: () => 'https://pay.google.com/gp/v/save/real-signed-token',
}));
vi.mock('../../src/server/wallet/apple', () => ({
  applePassTypeIdentifier: () => 'pass.org.nqta.loyalty',
  createAppleWalletPass: state.sign,
  pushAppleWalletUpdates: async () => [],
}));
let cookie: string;
let stranger: string;
beforeAll(async () => {
  vi.stubEnv('AUTH_MODE', 'recovery-key');
  state.db = await fixture();
  const service = createCustomerPasswordService(state.db);
  const a = await service.register('CorrectPassword123!');
  const b = await service.register('CorrectPassword123!');
  cookie = 'nqta_customer=' + a.token;
  stranger = 'nqta_customer=' + b.token;
  await state.db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('wallet-member','shop','programme',$1,'NQ-APIWALLET')",
    [a.customerId],
  );
});
afterAll(async () => {
  await state.db?.close();
});
beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'recovery-key');
  vi.stubEnv('APP_URL', 'https://loyalty.example.org');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('DEMO_MODE', 'false');
  vi.stubEnv('NODE_ENV', 'production');
  state.available = { google: false, apple: false };
  state.sync.mockReset().mockResolvedValue(undefined);
  state.sign.mockReset().mockResolvedValue(Buffer.from('signed-pass'));
  state.after.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
function call(
  path: string,
  body?: unknown,
  session = cookie,
  origin = 'https://loyalty.example.org',
) {
  const request = new NextRequest('https://loyalty.example.org/api/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: session, origin, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return (body ? POST : GET)(request, { params: Promise.resolve({ path: path.split('/') }) });
}
it('publishes only genuine availability and rejects unconfigured issuance safely', async () => {
  expect(await (await call('public/config')).json()).toMatchObject({
    wallet: { google: false, apple: false },
  });
  const response = await call('wallet/google', { membershipId: 'wallet-member' });
  expect(response.status).toBe(503);
  expect(state.sync).not.toHaveBeenCalled();
});
it('rejects foreign-origin and another customer before any Wallet transport', async () => {
  state.available = { google: true, apple: true };
  expect(
    (await call('wallet/google', { membershipId: 'wallet-member' }, cookie, 'https://evil.example'))
      .status,
  ).toBe(403);
  expect((await call('wallet/google', { membershipId: 'wallet-member' }, stranger)).status).toBe(
    403,
  );
  expect((await call('wallet/google', { membershipId: 'wallet-member' }, '')).status).toBe(401);
  expect(state.sync).not.toHaveBeenCalled();
  expect((await call('wallet/download/apple/wallet-member', undefined, stranger)).status).toBe(403);
  expect(state.sign).not.toHaveBeenCalled();
});
it('returns a Google save link only after durable synchronization', async () => {
  state.available.google = true;
  const response = await call('wallet/google', { membershipId: 'wallet-member' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url: 'https://pay.google.com/gp/v/save/real-signed-token',
  });
  expect(state.sync).toHaveBeenCalledOnce();
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('serves Apple through an owned cookie-bound native MIME download without tokens in its URL', async () => {
  state.available.apple = true;
  expect((await call('wallet/download/apple/wallet-member')).status).toBe(404);
  expect(
    (await state.db!.query("SELECT id FROM wallet_passes WHERE provider='apple'")).rows,
  ).toHaveLength(0);
  const response = await call('wallet/apple', { membershipId: 'wallet-member' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: '/api/wallet/download/apple/wallet-member' });
  const download = await call('wallet/download/apple/wallet-member');
  expect(download.status).toBe(200);
  expect(download.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
  expect(download.headers.get('cache-control')).toBe('no-store');
  expect(await download.text()).toBe('signed-pass');
  expect((await call('wallet/download/apple/wallet-member', undefined, '')).status).toBe(401);
});
