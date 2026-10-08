import { createHmac, createPrivateKey, timingSafeEqual, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { connect, constants } from 'node:http2';
import forge from 'node-forge';
import { PKPass } from 'passkit-generator';
import type { MembershipCard } from '../loyalty/types';
import { hostedTestMode } from '../environment';
import { WalletUnavailableError, type WalletPass } from './contracts';

// Public trust anchors from Apple's official PKI, retrieved 2026-10-08:
// https://www.apple.com/appleca/AppleIncRootCertificate.cer
// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
const APPLE_ROOTS = `-----BEGIN CERTIFICATE-----
MIIEuzCCA6OgAwIBAgIBAjANBgkqhkiG9w0BAQUFADBiMQswCQYDVQQGEwJVUzET
MBEGA1UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlv
biBBdXRob3JpdHkxFjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwHhcNMDYwNDI1MjE0
MDM2WhcNMzUwMjA5MjE0MDM2WjBiMQswCQYDVQQGEwJVUzETMBEGA1UEChMKQXBw
bGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkx
FjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw
ggEKAoIBAQDkkakJH5HbHkdQ6wXtXnmELes2oldMVeyLGYne+Uts9QerIjAC6Bg+
+FAJ039BqJj50cpmnCRrEdCju+QbKsMflZ56DKRHi1vUFjczy8QPTc4UadHJGXL1
XQ7Vf1+b8iUDulWPTV0N8WQ1IxVLFVkds5T39pyez1C6wVhQZ48ItCD3y6wsIG9w
tj8BMIy3Q88PnT3zK0koGsj+zrW5DtleHNbLPbU6rfQPDgCSC7EhFi501TwN22IW
q6NxkkdTVcGvL0Gz+PvjcM3mo0xFfh9Ma1CWQYnEdGILEINBhzOKgbEwWOxaBDKM
aLOPHd5lc/9nXmW8Sdh2nzMUZaF3lMktAgMBAAGjggF6MIIBdjAOBgNVHQ8BAf8E
BAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUK9BpR5R2Cf70a40uQKb3
R01/CF4wHwYDVR0jBBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4wggERBgNVHSAE
ggEIMIIBBDCCAQAGCSqGSIb3Y2QFATCB8jAqBggrBgEFBQcCARYeaHR0cHM6Ly93
d3cuYXBwbGUuY29tL2FwcGxlY2EvMIHDBggrBgEFBQcCAjCBthqBs1JlbGlhbmNl
IG9uIHRoaXMgY2VydGlmaWNhdGUgYnkgYW55IHBhcnR5IGFzc3VtZXMgYWNjZXB0
YW5jZSBvZiB0aGUgdGhlbiBhcHBsaWNhYmxlIHN0YW5kYXJkIHRlcm1zIGFuZCBj
b25kaXRpb25zIG9mIHVzZSwgY2VydGlmaWNhdGUgcG9saWN5IGFuZCBjZXJ0aWZp
Y2F0aW9uIHByYWN0aWNlIHN0YXRlbWVudHMuMA0GCSqGSIb3DQEBBQUAA4IBAQBc
NplMLXi37Yyb3PN3m/J20ncwT8EfhYOFG5k9RzfyqZtAjizUsZAS2L70c5vu0mQP
y3lPNNiiPvl4/2vIB+x9OYOLUyDTOMSxv5pPCmv/K/xZpwUJfBdAVhEedNO3iyM7
R6PVbyTi69G3cN8PReEnyvFteO3ntRcXqNx+IjXKJdXZD9Zr1KIkIxH3oayPc4Fg
xhtbCS+SsvhESPBgOJ4V9T0mZyCKM2r3DYLP3uujL/lTaltkwGMzd/c6ByxW69oP
IQ7aunMZT7XZNn/Bh1XZp5m5MkL72NVxnn6hUrcbvZNCJBIqxw8dtk2cXmPIS4AX
UKqK1drk/NAJBzewdXUh
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`
  .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)!
  .map((pem) => new X509Certificate(pem));
const ASSET_NAMES = ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'] as const;
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type AppleWalletCredentials = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  origin: string;
  authSecret: string;
  signerCert: Buffer;
  signerKey: Buffer;
  wwdr: Buffer;
};

function unavailable(): never {
  throw new WalletUnavailableError();
}
function decode(value: string | undefined): Buffer {
  if (
    !value ||
    value.length > 128_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
    value.length % 4 !== 0
  )
    return unavailable();
  return Buffer.from(value, 'base64');
}
function validAt(cert: X509Certificate, now: number) {
  return Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo);
}

// Explicit trust roots permit isolated cryptographic verification with synthetic
// test-only fixtures. The public provider always supplies the pinned Apple roots.
export function validateAppleWalletCredentials(
  env: Record<string, string | undefined>,
  trustedRoots: readonly X509Certificate[] = APPLE_ROOTS,
  now = new Date(),
): AppleWalletCredentials {
  try {
    const passTypeIdentifier = env.APPLE_WALLET_PASS_TYPE_ID || '';
    const teamIdentifier = env.APPLE_WALLET_TEAM_ID || '';
    const authSecret = env.APPLE_WALLET_AUTH_SECRET || '';
    if (
      !/^pass\.[A-Za-z0-9.-]{1,200}$/.test(passTypeIdentifier) ||
      !/^[A-Z0-9]{10}$/.test(teamIdentifier) ||
      authSecret.length < 32 ||
      authSecret.length > 1024 ||
      authSecret === env.SESSION_SECRET
    )
      return unavailable();
    const url = new URL(env.APP_URL || '');
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      return unavailable();
    const signerCert = new X509Certificate(decode(env.APPLE_WALLET_SIGNER_CERT_BASE64));
    const wwdr = new X509Certificate(decode(env.APPLE_WALLET_WWDR_CERT_BASE64));
    const key = createPrivateKey({
      key: decode(env.APPLE_WALLET_SIGNER_KEY_BASE64),
      passphrase: env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE,
    });
    if (
      key.asymmetricKeyType !== 'rsa' ||
      (key.asymmetricKeyDetails?.modulusLength || 0) < 2048 ||
      !signerCert.checkPrivateKey(key) ||
      signerCert.ca ||
      !wwdr.ca ||
      !validAt(signerCert, now.valueOf()) ||
      !validAt(wwdr, now.valueOf()) ||
      !signerCert.checkIssued(wwdr) ||
      !signerCert.verify(wwdr.publicKey) ||
      !trustedRoots.some(
        (root) =>
          root.ca &&
          validAt(root, now.valueOf()) &&
          wwdr.checkIssued(root) &&
          wwdr.verify(root.publicKey),
      )
    )
      return unavailable();
    const parsed = forge.pki.certificateFromPem(signerCert.toString());
    if (
      parsed.subject.getField({ type: '0.9.2342.19200300.100.1.1' })?.value !==
        passTypeIdentifier ||
      parsed.subject.getField('OU')?.value !== teamIdentifier ||
      !parsed.extensions.some((extension) => extension.id === '1.2.840.113635.100.6.1.16') ||
      !/Worldwide Developer Relations/.test(wwdr.subject)
    )
      return unavailable();
    return {
      passTypeIdentifier,
      teamIdentifier,
      authSecret,
      origin: url.origin,
      signerCert: Buffer.from(signerCert.toString()),
      signerKey: Buffer.from(key.export({ type: 'pkcs1', format: 'pem' })),
      wwdr: Buffer.from(wwdr.toString()),
    };
  } catch {
    return unavailable();
  }
}

function credentials() {
  if (hostedTestMode()) return unavailable();
  return validateAppleWalletCredentials(process.env);
}
function validAssets(assets: Record<string, Buffer>) {
  for (const name of ASSET_NAMES) {
    const asset = assets[name];
    if (
      !asset ||
      asset.length < 33 ||
      asset.length > 1_000_000 ||
      !asset.subarray(0, 8).equals(PNG_HEADER) ||
      asset.toString('ascii', 12, 16) !== 'IHDR' ||
      !asset.readUInt32BE(16) ||
      !asset.readUInt32BE(20)
    )
      return unavailable();
  }
  return Object.fromEntries(ASSET_NAMES.map((name) => [name, assets[name]]));
}
function assets() {
  return validAssets(
    Object.fromEntries(
      ASSET_NAMES.map((name) => [
        name,
        readFileSync(path.join(process.cwd(), 'public', 'wallet', name)),
      ]),
    ),
  );
}
export function appleWalletOptions(): boolean {
  try {
    credentials();
    assets();
    return true;
  } catch {
    return false;
  }
}
export function applePassTypeIdentifier(): string {
  const passType = process.env.APPLE_WALLET_PASS_TYPE_ID || '';
  if (!/^pass\.[A-Za-z0-9.-]{1,200}$/.test(passType)) return unavailable();
  return passType;
}
function authenticationToken(passId: string, secret: string) {
  return createHmac('sha256', secret)
    .update('nqta:apple-wallet:pass-auth:v1\0')
    .update(passId)
    .digest('hex');
}
export function appleWalletAuthorization(
  passId: string,
  header: string | null | undefined,
): boolean {
  const secret = process.env.APPLE_WALLET_AUTH_SECRET || '';
  if (
    secret.length < 32 ||
    secret.length > 1024 ||
    !header ||
    !/^ApplePass [a-f0-9]{64}$/.test(header) ||
    passId.length > 256
  )
    return false;
  return timingSafeEqual(
    Buffer.from(header.slice(10), 'hex'),
    Buffer.from(authenticationToken(passId, secret), 'hex'),
  );
}
function color(value: string) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : '24554a';
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return 'rgb(' + channels.join(', ') + ')';
}
function clean(value: string, limit = 1000) {
  return value.slice(0, limit);
}

export function buildAppleWalletPass(
  pass: WalletPass,
  card: MembershipCard,
  config: AppleWalletCredentials,
  imageAssets: Record<string, Buffer>,
): Buffer {
  try {
    if (
      pass.provider !== 'apple' ||
      pass.externalId !== config.passTypeIdentifier ||
      pass.membershipId !== card.id ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(pass.id)
    )
      return unavailable();
    const closed = card.status !== 'active';
    const pkpass = new PKPass(
      validAssets(imageAssets),
      {
        signerCert: config.signerCert,
        signerKey: config.signerKey,
        wwdr: config.wwdr,
      },
      {
        formatVersion: 1,
        passTypeIdentifier: config.passTypeIdentifier,
        teamIdentifier: config.teamIdentifier,
        serialNumber: pass.id,
        organizationName: 'Nqta',
        description: clean(card.shopName, 100) + ' loyalty card',
        logoText: clean(card.shopName, 100),
        backgroundColor: color(card.theme),
        foregroundColor: 'rgb(255, 255, 255)',
        labelColor: 'rgb(230, 240, 235)',
        voided: closed,
        webServiceURL: config.origin + '/api/wallet/apple',
        authenticationToken: authenticationToken(pass.id, config.authSecret),
      },
    );
    pkpass.type = 'storeCard';
    pkpass.primaryFields.push({
      key: 'points',
      label: closed ? 'MEMBERSHIP' : 'POINTS EARNED',
      value: closed ? 'Inactive' : card.totalStamps,
      ...(!closed ? { changeMessage: 'You now have %@ points.' } : {}),
    });
    if (!closed) {
      pkpass.headerFields.push({
        key: 'rewards',
        label: 'REWARDS',
        value: card.rewards.filter((reward) => reward.state === 'available').length,
      });
      pkpass.secondaryFields.push(
        { key: 'welcome', label: 'WELCOME', value: 'Hey, welcome back!' },
        {
          key: 'progress',
          label: 'NEXT REWARD',
          value: card.progress + ' / ' + card.threshold,
        },
      );
      pkpass.auxiliaryFields.push({
        key: 'earning',
        label: 'EARNING',
        value: card.shopStatus === 'paused' ? 'New earning is paused' : 'Show this QR at checkout',
      });
      pkpass.setBarcodes({
        format: 'PKBarcodeFormatQR',
        message: card.memberCode,
        messageEncoding: 'iso-8859-1',
      });
      pkpass.backFields.push(
        { key: 'reward', label: 'Your reward', value: clean(card.rewardDescription, 150) },
        { key: 'eligibility', label: 'Eligibility', value: clean(card.eligibility) },
        { key: 'terms', label: 'Terms', value: clean(card.terms) },
        {
          key: 'card',
          label: 'Your Nqta card',
          value: config.origin + '/card/' + encodeURIComponent(card.id),
        },
        {
          key: 'authoritative',
          label: 'Rewards',
          value:
            'The shop confirms stamp and reward balances. Redeem rewards through your Nqta card.',
        },
      );
    }
    pkpass.backFields.push({ key: 'contact', label: 'Nqta support', value: config.origin });
    return pkpass.getAsBuffer();
  } catch {
    return unavailable();
  }
}
export async function createAppleWalletPass(
  pass: WalletPass,
  card: MembershipCard,
): Promise<Buffer> {
  try {
    return buildAppleWalletPass(pass, card, credentials(), assets());
  } catch {
    return unavailable();
  }
}

export type ApplePushResult = { token: string; status: 'sent' | 'remove' | 'retry' };
export async function pushAppleWalletUpdates(tokens: string[]): Promise<ApplePushResult[]> {
  try {
    return await sendAppleWalletUpdates(tokens, credentials());
  } catch {
    return [...new Set(tokens)].map((token) => ({ token, status: 'retry' }));
  }
}
export async function sendAppleWalletUpdates(
  tokens: string[],
  config: AppleWalletCredentials,
  open: typeof connect = connect,
): Promise<ApplePushResult[]> {
  const unique = [...new Set(tokens)];
  const results = unique.map((token): ApplePushResult => ({ token, status: 'retry' }));
  const pending = results.filter((result) => /^[a-f0-9]{64,200}$/i.test(result.token)).slice(0, 64);
  for (const result of results)
    if (!/^[a-f0-9]{64,200}$/i.test(result.token)) result.status = 'remove';
  if (!pending.length) return results;
  // Wallet passes use production APNs even for development signing/testing.
  const client = open('https://api.push.apple.com', {
    cert: Buffer.concat([config.signerCert, config.wwdr]),
    key: config.signerKey,
  });
  await new Promise<void>((resolve) => {
    let remaining = pending.length;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      client.destroy();
      resolve();
    };
    const deadline = setTimeout(finish, 5000);
    client.on('error', finish);
    client.on('close', finish);
    for (const result of pending) {
      const stream = client.request({
        ':method': 'POST',
        ':path': '/3/device/' + result.token,
        'apns-topic': config.passTypeIdentifier,
        'apns-expiration': '0',
        'apns-priority': '5',
      });
      let status = 0;
      let body = '';
      let complete = false;
      const done = () => {
        if (complete) return;
        complete = true;
        if (--remaining === 0) finish();
      };
      stream.on('response', (headers) => {
        status = Number(headers[':status']);
      });
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 2048) {
          stream.close(constants.NGHTTP2_CANCEL);
          done();
        }
      });
      stream.on('end', () => {
        if (complete) return;
        let reason = '';
        try {
          reason = JSON.parse(body).reason || '';
        } catch {
          /* Safe retry for malformed responses. */
        }
        result.status =
          status === 200
            ? 'sent'
            : status === 410 ||
                (status === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(reason))
              ? 'remove'
              : 'retry';
        done();
      });
      stream.on('error', done);
      stream.on('close', done);
      stream.end('{}');
    }
  });
  return results;
}
