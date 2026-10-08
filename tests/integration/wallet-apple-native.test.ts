import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Database } from '../../src/server/db/client';
import { fixture } from './fixture';
import { createWalletStore, enqueueMembershipWalletUpdates } from '../../src/server/wallet/store';
import {
  validateAppleWalletCredentials,
  buildAppleWalletPass,
} from '../../src/server/wallet/apple';
import { testOnlyAppleCertificates, unzipApplePass } from '../helpers/apple-wallet';

let db: Database;
let certificates: ReturnType<typeof testOnlyAppleCertificates>;
let service: (request: Request, segments: string[]) => Promise<Response>;
let serial: string;
let token: string;
const pushToken = 'ab'.repeat(32);
beforeAll(() => {
  certificates = testOnlyAppleCertificates();
});
afterAll(() => certificates.cleanup());
beforeEach(async () => {
  db = await fixture();
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  for (const [key, value] of Object.entries(certificates.env)) vi.stubEnv(key, value);
  await db.query(
    "INSERT INTO customers(id,phone,name) VALUES('customer','+212600000000','PRIVATE CUSTOMER')",
  );
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('member','shop','programme','customer','NQ-PUBLIC-CODE')",
  );
  const wallet = await createWalletStore(db).getOrCreatePass(
    'customer',
    'member',
    'apple',
    'pass.test.nqta',
  );
  serial = wallet.pass.id;
  token = createHmac('sha256', certificates.env.APPLE_WALLET_AUTH_SECRET)
    .update('nqta:apple-wallet:pass-auth:v1\0')
    .update(serial)
    .digest('hex');
  const module = await import('../../src/server/wallet/apple-web-service').catch(() => undefined);
  expect(typeof module?.createAppleWebService).toBe('function');
  const signer = validateAppleWalletCredentials(certificates.env, [certificates.root]);
  const assets = Object.fromEntries(
    await Promise.all(
      ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'].map(async (name) => [
        name,
        await readFile(path.join(process.cwd(), 'public/wallet', name)),
      ]),
    ),
  );
  service = module!.createAppleWebService(db, {
    available: () => true,
    sign: async (pass, card) => buildAppleWalletPass(pass, card, signer, assets),
  });
});
afterEach(async () => {
  await db?.close();
  vi.unstubAllEnvs();
});
function request(
  segments: string[],
  method = 'GET',
  body?: unknown,
  authorization?: string,
  query = '',
) {
  return new Request('https://wallet.example.test/api/wallet/apple/' + segments.join('/') + query, {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
function registration(device = 'opaque-device-secret', pass = serial) {
  return ['v1', 'devices', device, 'registrations', 'pass.test.nqta', pass];
}
function listing(device = 'opaque-device-secret', type = 'pass.test.nqta') {
  return ['v1', 'devices', device, 'registrations', type];
}
function download(pass = serial) {
  return ['v1', 'passes', 'pass.test.nqta', pass];
}

it('accepts authenticated native registration without browser Origin and remains idempotent', async () => {
  const segments = registration();
  expect(
    (await service(request(segments, 'POST', { pushToken }, 'ApplePass ' + token), segments))
      .status,
  ).toBe(201);
  expect(
    (await service(request(segments, 'POST', { pushToken }, 'ApplePass ' + token), segments))
      .status,
  ).toBe(200);
  const listSegments = listing();
  const listed = await service(request(listSegments), listSegments);
  expect(listed.status).toBe(200);
  const payload = await listed.json();
  expect(payload.serialNumbers).toEqual([serial]);
  expect(payload.lastUpdated).toMatch(/^\d+$/);
  expect(
    (
      await service(
        request(
          listSegments,
          'GET',
          undefined,
          undefined,
          '?passesUpdatedSince=' + payload.lastUpdated,
        ),
        listSegments,
      )
    ).status,
  ).toBe(204);
});

it('rejects wrong pass auth, wrong pass type and invalid/oversized native registration bodies', async () => {
  const segments = registration();
  for (const auth of [
    undefined,
    'Bearer ' + token,
    'ApplePass NQ-PUBLIC-CODE',
    'ApplePass ' + '0'.repeat(64),
  ])
    expect((await service(request(segments, 'POST', { pushToken }, auth), segments)).status).toBe(
      401,
    );
  const other = registration('device', 'different-pass');
  expect(
    (await service(request(other, 'POST', { pushToken }, 'ApplePass ' + token), other)).status,
  ).toBe(401);
  for (const invalid of ['', 'not-a-token', 'aa', 'ab'.repeat(101)])
    expect(
      (
        await service(
          request(segments, 'POST', { pushToken: invalid }, 'ApplePass ' + token),
          segments,
        )
      ).status,
    ).toBe(400);
  expect(
    (
      await service(
        request(segments, 'POST', { pushToken, extra: 'x'.repeat(5000) }, 'ApplePass ' + token),
        segments,
      )
    ).status,
  ).toBe(413);
  const wrongType = ['v1', 'passes', 'pass.test.other', serial];
  expect(
    (await service(request(wrongType, 'GET', undefined, 'ApplePass ' + token), wrongType)).status,
  ).toBe(404);
  expect(await createWalletStore(db).getAppleDevices(serial)).toEqual([]);
});

it('only lists registered passes with a global revision watermark across cards and updates', async () => {
  await db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('programme-other','other',5,'A tea','One paid tea receipt','published')",
  );
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('member-other','other','programme-other','customer','NQ-OTHER')",
  );
  const second = await createWalletStore(db).getOrCreatePass(
    'customer',
    'member-other',
    'apple',
    'pass.test.nqta',
  );
  await createWalletStore(db).registerAppleDevice(serial, 'opaque-device-secret', pushToken);
  await createWalletStore(db).registerAppleDevice(second.pass.id, 'other-device-secret', pushToken);
  const segments = listing();
  const first = await (await service(request(segments), segments)).json();
  expect(first.serialNumbers).toEqual([serial]);
  await db.transaction((tx) => enqueueMembershipWalletUpdates(tx, 'member'));
  const revised = await (
    await service(
      request(segments, 'GET', undefined, undefined, '?passesUpdatedSince=' + first.lastUpdated),
      segments,
    )
  ).json();
  expect(revised.serialNumbers).toEqual([serial]);
  expect(BigInt(revised.lastUpdated)).toBeGreaterThan(BigInt(first.lastUpdated));
  for (const since of ['-1', 'invalid', '9223372036854775808'])
    expect(
      (
        await service(
          request(segments, 'GET', undefined, undefined, '?passesUpdatedSince=' + since),
          segments,
        )
      ).status,
    ).toBe(400);
  expect((await service(request(listing('unregistered')), listing('unregistered'))).status).toBe(
    204,
  );
  expect(
    (
      await service(
        request(listing('opaque-device-secret', 'pass.test.other')),
        listing('opaque-device-secret', 'pass.test.other'),
      )
    ).status,
  ).toBe(404);
});

it('returns signed passes with scoped auth, safe revision caching and inactive privacy refresh', async () => {
  const segments = download();
  expect((await service(request(segments), segments)).status).toBe(401);
  const first = await service(request(segments, 'GET', undefined, 'ApplePass ' + token), segments);
  expect(first.status).toBe(200);
  expect(first.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
  const files = unzipApplePass(Buffer.from(await first.arrayBuffer()));
  expect(certificates.verify(files.signature, files['manifest.json'])).toEqual(
    files['manifest.json'],
  );
  expect(JSON.parse(files['pass.json'].toString()).barcodes[0].message).toBe('NQ-PUBLIC-CODE');
  const cached = new Request(request(segments, 'GET', undefined, 'ApplePass ' + token), {
    headers: { authorization: 'ApplePass ' + token, 'if-none-match': first.headers.get('etag')! },
  });
  expect((await service(cached, segments)).status).toBe(304);
  // A second revision in the same HTTP timestamp second cannot be hidden by304.
  await db.transaction(async (tx) => {
    await enqueueMembershipWalletUpdates(tx, 'member');
    await tx.query('UPDATE wallet_passes SET updated_at=$2 WHERE id=$1', [
      serial,
      first.headers.get('last-modified'),
    ]);
  });
  const timestampOnly = new Request(request(segments, 'GET', undefined, 'ApplePass ' + token), {
    headers: {
      authorization: 'ApplePass ' + token,
      'if-modified-since': first.headers.get('last-modified')!,
    },
  });
  expect((await service(timestampOnly, segments)).status).toBe(200);
  await db.transaction(async (tx) => {
    await tx.query("UPDATE memberships SET status='closed' WHERE id='member'");
    await enqueueMembershipWalletUpdates(tx, 'member');
  });
  const inactive = await service(cached, segments);
  expect(inactive.status).toBe(200);
  const pass = JSON.parse(
    unzipApplePass(Buffer.from(await inactive.arrayBuffer()))['pass.json'].toString(),
  );
  expect(pass.voided).toBe(true);
  expect(pass.barcodes).toBeUndefined();
  expect(JSON.stringify(pass)).not.toContain('PRIVATE CUSTOMER');
  expect(JSON.stringify(pass)).not.toContain('NQ-PUBLIC-CODE');
  expect(JSON.stringify(pass)).not.toContain('/card/member');
  expect(pass.authenticationToken).toBe(token);
});

it('unregisters only the authenticated pass/device pair and bounds diagnostics without logging content', async () => {
  await createWalletStore(db).registerAppleDevice(serial, 'opaque-device-secret', pushToken);
  await createWalletStore(db).registerAppleDevice(serial, 'another-device', pushToken);
  const segments = registration();
  expect((await service(request(segments, 'DELETE'), segments)).status).toBe(401);
  expect(
    (await service(request(segments, 'DELETE', undefined, 'ApplePass ' + token), segments)).status,
  ).toBe(200);
  expect(await createWalletStore(db).getAppleDevices(serial)).toEqual([
    { deviceId: 'another-device', pushToken },
  ]);
  const logging = ['v1', 'log'];
  const spy = vi.spyOn(console, 'log');
  expect(
    (
      await service(
        request(logging, 'POST', { logs: ['Sensitive device data should never be emitted'] }),
        logging,
      )
    ).status,
  ).toBe(200);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
  expect(
    (await service(request(logging, 'POST', { logs: ['x'.repeat(5000)] }), logging)).status,
  ).toBe(413);
});

it('preserves hosted test Basic access at the native route boundary', async () => {
  const route = await import('../../src/app/api/wallet/apple/[...path]/route');
  vi.stubEnv('HOSTED_TEST_MODE', 'true');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DATABASE_URL', 'postgresql://test:unused@example.com/test');
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-longer-than-32-characters');
  vi.stubEnv('TEST_ACCESS_PASSWORD', 'test-site-password-longer-than-16');
  const denied = await route.POST(
    new NextRequest(request(registration(), 'POST', { pushToken }, 'ApplePass ' + token)),
    { params: Promise.resolve({ path: registration() }) },
  );
  expect(denied.status).toBe(401);
  expect(denied.headers.get('www-authenticate')).toContain('Basic');
});
