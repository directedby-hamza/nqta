import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';
import type { MembershipCard } from '../loyalty/types';
import { WalletUnavailableError, type WalletPass } from './contracts';

const oauthUrl = 'https://oauth2.googleapis.com/token';
const walletApi = 'https://walletobjects.googleapis.com/walletobjects/v1';
const scope = 'https://www.googleapis.com/auth/wallet_object';
const requestTimeoutMs = 10000;
const deliveryTimeoutMs = 35000;

type Configuration = { issuerId: string; email: string; key: KeyObject; origin: string };
type Resource = Record<string, unknown> & { id: string };
type Delivery = { token: string; deadline: AbortSignal };

function configuration(): Configuration {
  try {
    const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID || '';
    const publishing = process.env.GOOGLE_WALLET_PUBLISHING_ACCESS;
    if (
      !/^\d{1,30}$/.test(issuerId) ||
      !['approved', 'demo'].includes(publishing || '') ||
      (process.env.NODE_ENV === 'production' && publishing !== 'approved')
    )
      throw new WalletUnavailableError();

    const app = new URL(process.env.APP_URL || '');
    if (
      app.protocol !== 'https:' ||
      app.username ||
      app.password ||
      app.pathname !== '/' ||
      app.search ||
      app.hash ||
      !app.hostname.includes('.') ||
      app.hostname === 'localhost' ||
      app.hostname.endsWith('.localhost') ||
      /^[\d.]+$/.test(app.hostname) ||
      app.hostname.startsWith('[')
    )
      throw new WalletUnavailableError();

    const encoded = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64 || '';
    if (!encoded || encoded.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      throw new WalletUnavailableError();
    const account = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (
      account?.type !== 'service_account' ||
      typeof account.client_email !== 'string' ||
      !/^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account.client_email) ||
      typeof account.private_key !== 'string'
    )
      throw new WalletUnavailableError();
    const key = createPrivateKey(account.private_key);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048)
      throw new WalletUnavailableError();
    return { issuerId, email: account.client_email, key, origin: app.origin };
  } catch {
    // Credential material and parsing/provider causes must never reach callers or logs.
    throw new WalletUnavailableError();
  }
}

export function googleWalletOptions(): boolean {
  try {
    configuration();
    return true;
  } catch {
    return false;
  }
}

function resourceId(config: Configuration, kind: 'member' | 'shop', id: string): string {
  if (!id || id.length > 256) throw new WalletUnavailableError();
  const digest = createHash('sha256').update(id).digest('hex').slice(0, 40);
  return `${config.issuerId}.nqta_${kind}_${digest}`;
}

export function googleWalletObjectId(membershipId: string): string {
  return resourceId(configuration(), 'member', membershipId);
}

function assertPass(config: Configuration, pass: WalletPass) {
  if (
    pass.provider !== 'google' ||
    pass.externalId !== resourceId(config, 'member', pass.membershipId)
  )
    throw new WalletUnavailableError();
}

function jwt(config: Configuration, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), config.key).toString('base64url')}`;
}

export function googleWalletSaveUrl(pass: WalletPass): string {
  try {
    const config = configuration();
    assertPass(config, pass);
    if (
      !/^\d{1,30}$/.test(pass.revision) ||
      !/^\d{1,30}$/.test(pass.syncedRevision) ||
      BigInt(pass.syncedRevision) < BigInt(pass.revision)
    )
      throw new WalletUnavailableError();
    const now = Math.floor(Date.now() / 1000);
    return `https://pay.google.com/gp/v/save/${jwt(config, {
      iss: config.email,
      aud: 'google',
      typ: 'savetowallet',
      iat: now,
      exp: now + 300,
      origins: [config.origin],
      payload: { loyaltyObjects: [{ id: pass.externalId }] },
    })}`;
  } catch {
    throw new WalletUnavailableError();
  }
}

async function request(
  url: string,
  options: RequestInit,
  deadline: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    ...options,
    signal: AbortSignal.any([deadline, AbortSignal.timeout(requestTimeoutMs)]),
    redirect: 'error',
  });
}

async function accessToken(config: Configuration, deadline: AbortSignal): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt(config, {
    iss: config.email,
    scope,
    aud: oauthUrl,
    iat: now,
    exp: now + 3600,
  });
  const response = await request(
    oauthUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    },
    deadline,
  );
  if (!response.ok) throw new WalletUnavailableError();
  const token = await response.json();
  if (
    typeof token?.access_token !== 'string' ||
    !/^[\x21-\x7e]{1,8192}$/.test(token.access_token) ||
    token.token_type !== 'Bearer' ||
    typeof token.expires_in !== 'number' ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in <= 0
  )
    throw new WalletUnavailableError();
  return token.access_token;
}

async function rest(
  delivery: Delivery,
  path: string,
  method: string,
  body?: Resource,
): Promise<Response> {
  return request(
    `${walletApi}/${path}`,
    {
      method,
      headers: { authorization: `Bearer ${delivery.token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    delivery.deadline,
  );
}

async function resourceResponse(
  response: Response,
  expectedId: string,
  expectedClassId?: string,
): Promise<Record<string, unknown>> {
  if (!response.ok) throw new WalletUnavailableError();
  const result = await response.json();
  if (
    !result ||
    result.id !== expectedId ||
    (expectedClassId && result.classId !== expectedClassId)
  )
    throw new WalletUnavailableError();
  return result;
}

function text(value: string, limit = 4000): string {
  return value.trim().slice(0, limit);
}

function loyaltyClass(config: Configuration, card: MembershipCard): Resource {
  return {
    id: resourceId(config, 'shop', card.shopId),
    issuerName: text(card.shopName, 100),
    programName: text(card.shopName, 100),
    programLogo: {
      sourceUri: { uri: `${config.origin}/wallet/nqta-logo.png` },
      contentDescription: { defaultValue: { language: 'en', value: 'Nqta loyalty card' } },
    },
    hexBackgroundColor: /^#[a-f\d]{6}$/i.test(card.theme) ? card.theme : '#175c46',
  };
}

function loyaltyObject(
  config: Configuration,
  pass: WalletPass,
  card: MembershipCard,
  classId: string,
): Resource {
  if (card.status !== 'active') {
    // Full PUT removes the formerly active barcode and links rather than retaining omitted PATCH fields.
    return {
      id: pass.externalId,
      classId,
      state: 'INACTIVE',
      textModulesData: [
        { id: 'status', header: 'Card status', body: 'This loyalty card is no longer active.' },
      ],
    };
  }
  const modules = [
    { id: 'reward', header: 'Reward', body: text(card.rewardDescription) },
    { id: 'eligibility', header: 'Eligible visits', body: text(card.eligibility) },
    { id: 'terms', header: 'Terms', body: text(card.terms) },
    {
      id: 'status',
      header: 'Card status',
      body:
        card.shopStatus === 'paused'
          ? 'New earning is paused. Earned rewards remain available.'
          : 'Show this QR to the cashier to earn stamps. Confirm rewards with the cashier.',
    },
  ].filter(({ body }) => body);
  return {
    id: pass.externalId,
    classId,
    state: 'ACTIVE',
    barcode: { type: 'QR_CODE', value: card.memberCode },
    loyaltyPoints: { label: 'Stamps', balance: { string: `${card.progress} / ${card.threshold}` } },
    secondaryLoyaltyPoints: {
      label: 'Rewards',
      balance: { int: card.rewards.filter(({ state }) => state === 'available').length },
    },
    textModulesData: modules,
    linksModuleData: {
      uris: [
        {
          uri: `${config.origin}/card/${encodeURIComponent(card.id)}?shop=${encodeURIComponent(card.shopSlug)}`,
          description: 'Open your Nqta card',
        },
      ],
    },
  };
}

async function syncClass(delivery: Delivery, resource: Resource): Promise<void> {
  const path = `loyaltyClass/${resource.id}`;
  let existing = await rest(delivery, path, 'GET');
  if (existing.status === 404) {
    const created = await rest(delivery, 'loyaltyClass', 'POST', {
      ...resource,
      reviewStatus: 'UNDER_REVIEW',
    });
    if (created.status !== 409) {
      await resourceResponse(created, resource.id);
      return;
    }
    existing = await rest(delivery, path, 'GET');
  }
  await resourceResponse(existing, resource.id);
  // Google controls approval after submission; never overwrite an already approved reviewStatus.
  await resourceResponse(await rest(delivery, path, 'PATCH', resource), resource.id);
}

async function syncObject(delivery: Delivery, resource: Resource): Promise<void> {
  const path = `loyaltyObject/${resource.id}`;
  let response = await rest(delivery, path, 'PUT', resource);
  if (response.status === 404) {
    response = await rest(delivery, 'loyaltyObject', 'POST', resource);
    if (response.status === 409) response = await rest(delivery, path, 'PUT', resource);
  }
  await resourceResponse(response, resource.id, resource.classId as string);
}

export async function syncGoogleWalletPass(pass: WalletPass, card: MembershipCard): Promise<void> {
  try {
    const config = configuration();
    assertPass(config, pass);
    if (card.id !== pass.membershipId) throw new WalletUnavailableError();
    const shop = loyaltyClass(config, card);
    const object = loyaltyObject(config, pass, card, shop.id);
    // A complete conflict/retry flow must finish before the store's 60-second delivery lease.
    const deadline = AbortSignal.timeout(deliveryTimeoutMs);
    const delivery = { token: await accessToken(config, deadline), deadline };
    await syncClass(delivery, shop);
    await syncObject(delivery, object);
  } catch {
    throw new WalletUnavailableError();
  }
}
