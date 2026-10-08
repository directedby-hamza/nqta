import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MembershipCard } from '../../src/server/loyalty/types';
import { WalletUnavailableError, type WalletPass } from '../../src/server/wallet/contracts';
import {
  googleWalletObjectId,
  googleWalletOptions,
  googleWalletSaveUrl,
  syncGoogleWalletPass,
} from '../../src/server/wallet/google';

// Generated only in tests; these keys are never provider credentials or shipped assets.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = {
  type: 'service_account',
  client_email: 'wallet@nqta-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
};
const membershipId = '11111111-1111-4111-8111-111111111111';
const objectId = '3388000000000000000.nqta_member_bd7662a5eeb41614e720d477abfcb2272e19a8a7';
const classId = '3388000000000000000.nqta_shop_b454f82c5857ebabf342b7258e5cf7def78b7cd9';
const api = 'https://walletobjects.googleapis.com/walletobjects/v1';
const pass: WalletPass = {
  id: 'private-pass-serial',
  membershipId,
  provider: 'google',
  externalId: objectId,
  revision: '12',
  syncedRevision: '12',
};
const card: MembershipCard = {
  id: membershipId,
  memberCode: 'NQTA-PUBLIC-MEMBER-CODE',
  name: 'Private Customer Name',
  phone: '+212600000000',
  shopId: '22222222-2222-4222-8222-222222222222',
  shopName: 'Neighbourhood Café',
  shopSlug: 'neighbourhood-cafe',
  theme: '#175c46',
  location: 'Casablanca',
  programmeId: 'private-programme-id',
  threshold: 8,
  rewardDescription: 'Free coffee',
  eligibility: 'One stamp for each eligible visit.',
  terms: 'Confirm rewards with the cashier.',
  progress: 3,
  totalStamps: 11,
  rewards: [
    {
      id: 'private-available-reward',
      state: 'available',
      description: 'Free coffee',
      createdAt: '2026-10-01',
    },
    {
      id: 'private-used-reward',
      state: 'redeemed',
      description: 'Free coffee',
      createdAt: '2026-10-01',
    },
  ],
  needsReview: false,
  status: 'active',
  consents: { sms: true, whatsapp: true },
};

function credentialEnv(value = credentials) {
  vi.stubEnv(
    'GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64',
    Buffer.from(JSON.stringify(value)).toString('base64'),
  );
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('APP_URL', 'https://nqta.example');
  vi.stubEnv('GOOGLE_WALLET_ISSUER_ID', '3388000000000000000');
  vi.stubEnv('GOOGLE_WALLET_PUBLISHING_ACCESS', 'demo');
  credentialEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jwtClaims(jwt: string) {
  const [header, payload, signature] = jwt.split('.');
  expect(
    verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    ),
  ).toBe(true);
  expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({
    alg: 'RS256',
    typ: 'JWT',
  });
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

type GoogleRequest = {
  url: string;
  method: string;
  body: Record<string, unknown>;
  headers: Headers;
  signal: AbortSignal | null;
  redirect: RequestRedirect;
};

function transport(respond?: (request: GoogleRequest) => Response | Promise<Response>) {
  const requests: GoogleRequest[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
    const request = new Request(input, options);
    const raw = await request.text();
    const body = request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded')
      ? Object.fromEntries(new URLSearchParams(raw))
      : raw
        ? JSON.parse(raw)
        : {};
    const recorded = {
      url: request.url,
      method: request.method,
      body,
      headers: request.headers,
      signal: options?.signal || null,
      redirect: request.redirect,
    };
    requests.push(recorded);
    if (respond) return respond(recorded);
    if (request.url === 'https://oauth2.googleapis.com/token')
      return Response.json({
        access_token: 'private-oauth-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    if (request.method === 'GET') return Response.json({ id: classId, reviewStatus: 'APPROVED' });
    return Response.json(recorded.body);
  });
  return requests;
}

it('makes stable opaque IDs so repeated issuance references the same membership object', () => {
  expect(googleWalletObjectId(membershipId)).toBe(objectId);
  expect(googleWalletObjectId(membershipId)).toBe(objectId);
  expect(googleWalletObjectId('different-membership')).not.toBe(objectId);
  expect(objectId).not.toContain(membershipId);
});

it('cryptographically signs a short save JWT referring only to an existing Google object', () => {
  const before = Math.floor(Date.now() / 1000);
  const url = googleWalletSaveUrl(pass);
  expect(url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);
  const claims = jwtClaims(url.split('/').at(-1)!);
  expect(claims).toMatchObject({
    iss: credentials.client_email,
    aud: 'google',
    typ: 'savetowallet',
    origins: ['https://nqta.example'],
    payload: { loyaltyObjects: [{ id: objectId }] },
  });
  expect(claims.iat).toBeGreaterThanOrEqual(before);
  expect(claims.exp - claims.iat).toBe(300);
  expect(claims.payload).toEqual({ loyaltyObjects: [{ id: objectId }] });
  expect(JSON.stringify(claims)).not.toMatch(
    /Private Customer|212600000000|MEMBER-CODE|private-pass|private-available|private-oauth/,
  );
});

it.each([
  { ...pass, syncedRevision: '11' },
  { ...pass, syncedRevision: 'invalid-revision' },
  { ...pass, revision: '-1' },
])('does not issue a save link until the current revision has synchronized', (pendingPass) => {
  expect(() => googleWalletSaveUrl(pendingPass)).toThrow(WalletUnavailableError);
});

it('exposes demo only in nonproduction and requires explicitly approved production publishing', () => {
  expect(googleWalletOptions()).toBe(true);
  vi.stubEnv('NODE_ENV', 'production');
  expect(googleWalletOptions()).toBe(false);
  vi.stubEnv('HOSTED_TEST_MODE', 'true');
  expect(googleWalletOptions()).toBe(false);
  vi.stubEnv('GOOGLE_WALLET_PUBLISHING_ACCESS', 'approved');
  expect(googleWalletOptions()).toBe(true);
});

it.each([
  ['GOOGLE_WALLET_ISSUER_ID', ''],
  ['GOOGLE_WALLET_ISSUER_ID', 'issuer.invalid'],
  ['GOOGLE_WALLET_PUBLISHING_ACCESS', ''],
  ['GOOGLE_WALLET_PUBLISHING_ACCESS', 'unverified'],
  ['GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64', 'not-json'],
  ['GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64', Buffer.from('{}').toString('base64')],
  ['APP_URL', ''],
  ['APP_URL', 'http://nqta.example'],
  ['APP_URL', 'https://nqta.example/card'],
  ['APP_URL', 'https://secret@nqta.example'],
  ['APP_URL', 'https://nqta.example?token=secret'],
  ['APP_URL', 'https://nqta.example/#fragment'],
  ['APP_URL', 'https://localhost'],
])('hides unavailable Google Wallet for invalid %s configuration', async (name, value) => {
  vi.stubEnv(name, value);
  let networkRequests = 0;
  vi.stubGlobal('fetch', () => {
    networkRequests++;
    throw new Error('must fail before sending credentials');
  });
  expect(googleWalletOptions()).toBe(false);
  expect(() => googleWalletSaveUrl(pass)).toThrow(WalletUnavailableError);
  await expect(syncGoogleWalletPass(pass, card)).rejects.toBeInstanceOf(WalletUnavailableError);
  expect(networkRequests).toBe(0);
});

it.each([
  { ...credentials, type: 'authorized_user' },
  { ...credentials, client_email: 'not-a-service-account@example.com' },
  { ...credentials, private_key: 'private-credential-invalid-key' },
  {
    ...credentials,
    private_key: generateKeyPairSync('rsa', { modulusLength: 1024 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  },
  {
    ...credentials,
    private_key: generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  },
])('refuses malformed or unsuitable service-account credential material', (value) => {
  credentialEnv(value);
  expect(googleWalletOptions()).toBe(false);
  expect(() => googleWalletSaveUrl(pass)).toThrow(WalletUnavailableError);
});

it('signs OAuth assertions and synchronizes genuine resources without exposing customer identity', async () => {
  credentialEnv({ ...credentials, token_uri: 'https://untrusted.example/steal-key' });
  const requests = transport();
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  await expect(syncGoogleWalletPass(pass, card)).resolves.toBeUndefined();

  expect(requests.map(({ url, method }) => [method, url])).toEqual([
    ['POST', 'https://oauth2.googleapis.com/token'],
    ['GET', `${api}/loyaltyClass/${classId}`],
    ['PATCH', `${api}/loyaltyClass/${classId}`],
    ['PUT', `${api}/loyaltyObject/${objectId}`],
  ]);
  const oauth = requests[0];
  expect(oauth.body.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  const assertion = jwtClaims(oauth.body.assertion as string);
  expect(assertion).toMatchObject({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/wallet_object',
    aud: 'https://oauth2.googleapis.com/token',
  });
  expect(assertion.exp - assertion.iat).toBe(3600);
  for (const request of requests) {
    expect(request.redirect).toBe('error');
    expect(request.signal).toBeInstanceOf(AbortSignal);
  }
  expect(timeout.mock.calls[0]).toEqual([35000]);
  expect(timeout.mock.calls.slice(1).every(([duration]) => duration === 10000)).toBe(true);
  const shop = requests[2].body;
  expect(shop).toMatchObject({
    id: classId,
    issuerName: card.shopName,
    programName: card.shopName,
    hexBackgroundColor: '#175c46',
    programLogo: { sourceUri: { uri: 'https://nqta.example/wallet/nqta-logo.png' } },
  });
  expect(shop).not.toHaveProperty('reviewStatus');
  const object = requests[3].body;
  expect(object).toMatchObject({
    id: objectId,
    classId,
    state: 'ACTIVE',
    barcode: { type: 'QR_CODE', value: 'NQTA-PUBLIC-MEMBER-CODE' },
    loyaltyPoints: { label: 'Stamps', balance: { string: '3 / 8' } },
    secondaryLoyaltyPoints: { label: 'Rewards', balance: { int: 1 } },
  });
  expect(object.textModulesData).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ body: card.eligibility }),
      expect.objectContaining({ body: card.terms }),
    ]),
  );
  expect(object.linksModuleData).toMatchObject({
    uris: [
      {
        uri: `https://nqta.example/card/${membershipId}?shop=neighbourhood-cafe`,
        description: 'Open your Nqta card',
      },
    ],
  });
  expect(requests[3].headers.get('authorization')).toBe('Bearer private-oauth-token');
  const resourceData = JSON.stringify(requests.slice(1).map(({ body }) => body));
  expect(resourceData).not.toMatch(
    /Private Customer|212600000000|private-programme|private-available|private-used|accountName|accountId|consents|session|password|recovery/i,
  );
});

it('creates missing resources before returning with a reviewable class and stable IDs', async () => {
  const requests = transport((request) => {
    if (request.url.endsWith('/token'))
      return Response.json({
        access_token: 'test-oauth-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    if (request.method === 'GET' || request.method === 'PUT')
      return new Response('', { status: 404 });
    return Response.json(request.body);
  });
  await syncGoogleWalletPass(pass, card);
  expect(requests.map(({ method }) => method)).toEqual(['POST', 'GET', 'POST', 'PUT', 'POST']);
  expect(requests[2]).toMatchObject({
    url: `${api}/loyaltyClass`,
    body: { id: classId, reviewStatus: 'UNDER_REVIEW' },
  });
  expect(requests[4]).toMatchObject({
    url: `${api}/loyaltyObject`,
    body: { id: objectId, classId },
  });
});

it('handles concurrent creation conflicts by updating the already-created stable resources', async () => {
  let classGets = 0;
  let objectPuts = 0;
  const requests = transport((request) => {
    if (request.url.endsWith('/token'))
      return Response.json({
        access_token: 'test-oauth-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    if (request.method === 'GET')
      return ++classGets === 1
        ? new Response('', { status: 404 })
        : Response.json({ id: classId, reviewStatus: 'APPROVED' });
    if (request.method === 'POST') return new Response('', { status: 409 });
    if (request.method === 'PUT' && ++objectPuts === 1) return new Response('', { status: 404 });
    return Response.json(request.body);
  });
  await syncGoogleWalletPass(pass, card);
  expect(requests.map(({ method }) => method)).toEqual([
    'POST',
    'GET',
    'POST',
    'GET',
    'PATCH',
    'PUT',
    'POST',
    'PUT',
  ]);
  expect(requests.at(-1)?.body).toMatchObject({ id: objectId, state: 'ACTIVE' });
});

it('replaces closed Google objects as inactive without retaining a QR or customer card link', async () => {
  const requests = transport();
  await syncGoogleWalletPass(pass, { ...card, status: 'closed' });
  const object = requests.at(-1)!.body;
  expect(requests.at(-1)!.method).toBe('PUT');
  expect(object.state).toBe('INACTIVE');
  expect(object).not.toHaveProperty('barcode');
  expect(object).not.toHaveProperty('linksModuleData');
  expect(object).not.toHaveProperty('loyaltyPoints');
  expect(object).not.toHaveProperty('secondaryLoyaltyPoints');
  expect(JSON.stringify(object)).not.toMatch(
    /MEMBER-CODE|Private Customer|212600000000|11111111|private-available/,
  );
});

it('keeps paused shop QR and earned progress while showing earning is paused', async () => {
  const requests = transport();
  await syncGoogleWalletPass(pass, { ...card, shopStatus: 'paused' } as MembershipCard);
  const object = requests.at(-1)!.body;
  expect(object).toMatchObject({ state: 'ACTIVE', barcode: { value: card.memberCode } });
  expect(object.textModulesData).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ body: expect.stringMatching(/earning.*paused/i) }),
    ]),
  );
});

it.each([
  { ...pass, provider: 'apple' as const },
  { ...pass, externalId: 'foreign-issuer.another-member' },
  { ...pass, membershipId: 'another-member' },
])('refuses to write another provider or membership resource', async (invalidPass) => {
  let networkRequests = 0;
  vi.stubGlobal('fetch', () => {
    networkRequests++;
    throw new Error('must refuse before any network');
  });
  await expect(syncGoogleWalletPass(invalidPass, card)).rejects.toBeInstanceOf(
    WalletUnavailableError,
  );
  expect(networkRequests).toBe(0);
  expect(() => googleWalletSaveUrl(invalidPass)).toThrow(WalletUnavailableError);
});

it.each(['oauth', 'class', 'object'] as const)(
  'returns a private retryable error when %s delivery fails',
  async (stage) => {
    const requests = transport((request) => {
      if (request.url.endsWith('/token'))
        return stage === 'oauth'
          ? new Response('private-provider-response', { status: 401 })
          : Response.json({
              access_token: 'private-oauth-token',
              token_type: 'Bearer',
              expires_in: 3600,
            });
      if (request.method === 'GET')
        return stage === 'class'
          ? new Response('private-provider-response', { status: 403 })
          : Response.json({ id: classId, reviewStatus: 'APPROVED' });
      if (request.method === 'PUT' && stage === 'object')
        return new Response('private-provider-response', { status: 429 });
      return Response.json(request.body);
    });
    const error = await syncGoogleWalletPass(pass, card).catch((cause) => cause);
    expect(error).toBeInstanceOf(WalletUnavailableError);
    expect(error.status).toBe(503);
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toMatch(
      /private-provider-response|private-oauth|MEMBER-CODE|Private Customer/,
    );
    expect(requests.at(-1)?.method).toBe(
      stage === 'class' ? 'GET' : stage === 'object' ? 'PUT' : 'POST',
    );
  },
);

it.each([
  '{}',
  'null',
  'private-malformed-response',
  JSON.stringify({ access_token: 'private-token\nheader', token_type: 'Bearer', expires_in: 3600 }),
  JSON.stringify({ access_token: 'private-token', token_type: 'Other', expires_in: 3600 }),
  JSON.stringify({ access_token: 'private-token', token_type: 'Bearer', expires_in: 0 }),
])('rejects malformed OAuth success responses without leaking provider content', async (body) => {
  transport(() => new Response(body, { status: 200 }));
  await expect(syncGoogleWalletPass(pass, card)).rejects.toMatchObject({ status: 503 });
});

it('rejects a provider success that refers to the wrong resource ID', async () => {
  transport((request) => {
    if (request.url.endsWith('/token'))
      return Response.json({
        access_token: 'test-oauth-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    return Response.json({ id: 'another-issuer.another-resource' });
  });
  await expect(syncGoogleWalletPass(pass, card)).rejects.toBeInstanceOf(WalletUnavailableError);
});

it('rejects an object success that refers to another shop class', async () => {
  transport((request) => {
    if (request.url.endsWith('/token'))
      return Response.json({
        access_token: 'test-oauth-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    if (request.method === 'GET') return Response.json({ id: classId, reviewStatus: 'APPROVED' });
    if (request.method === 'PUT')
      return Response.json({ ...request.body, classId: 'another-issuer.another-shop' });
    return Response.json(request.body);
  });
  await expect(syncGoogleWalletPass(pass, card)).rejects.toBeInstanceOf(WalletUnavailableError);
});

it('bounds the whole delivery attempt below the lease even across several provider requests', async () => {
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((duration) =>
    duration === 35000 ? deadline.signal : new AbortController().signal,
  );
  let reachedClass!: () => void;
  const classStarted = new Promise<void>((resolve) => {
    reachedClass = resolve;
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
    if (String(input).endsWith('/token'))
      return Response.json({
        access_token: 'test-oauth-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    return new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
        once: true,
      });
      reachedClass();
    });
  });
  const pending = syncGoogleWalletPass(pass, card);
  await classStarted;
  deadline.abort(new DOMException('private-whole-delivery-deadline', 'TimeoutError'));
  await expect(pending).rejects.toBeInstanceOf(WalletUnavailableError);
});

it('limits network waits and hides timeout details from the customer', async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  vi.stubGlobal(
    'fetch',
    async (_input: RequestInfo | URL, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
          once: true,
        });
      }),
  );
  const pending = syncGoogleWalletPass(pass, card);
  controller.abort(new DOMException('private-provider-token timeout', 'TimeoutError'));
  const error = await pending.catch((cause) => cause);
  expect(error).toBeInstanceOf(WalletUnavailableError);
  expect(String(error)).not.toMatch(/private-provider-token|timeout/i);
  expect(error.cause).toBeUndefined();
});
