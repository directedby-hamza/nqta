import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  appleCard,
  applePass,
  testOnlyAppleCertificates,
  unzipApplePass,
} from '../helpers/apple-wallet';
import * as apple from '../../src/server/wallet/apple';

let certificates: ReturnType<typeof testOnlyAppleCertificates>;
beforeAll(() => {
  certificates = testOnlyAppleCertificates();
});
afterAll(() => certificates.cleanup());

afterEach(() => vi.unstubAllEnvs());

it('keeps Apple unavailable when genuine signing configuration is missing', async () => {
  vi.stubEnv('APPLE_WALLET_SIGNER_CERT_BASE64', '');
  const enabled = await import('../../src/server/wallet/apple')
    .then((apple) => apple.appleWalletOptions())
    .catch(() => undefined);
  expect(enabled).toBe(false);
});

it('rejects synthetic roots in normal provider options', () => {
  for (const [key, value] of Object.entries(certificates.env)) vi.stubEnv(key, value);
  expect(apple.appleWalletOptions()).toBe(false);
});

it('validates real signatures, matching pass/team identities, keys, validity and HTTPS origin', () => {
  const api = apple as unknown as Record<string, (...args: unknown[]) => any>;
  expect(typeof api.validateAppleWalletCredentials).toBe('function');
  const validated = api.validateAppleWalletCredentials(certificates.env, [certificates.root]);
  expect(validated.passTypeIdentifier).toBe('pass.test.nqta');
  for (const patch of [
    { APPLE_WALLET_PASS_TYPE_ID: 'pass.test.other' },
    { APPLE_WALLET_TEAM_ID: 'OTHERTEAM1' },
    { APPLE_WALLET_AUTH_SECRET: 'short' },
    { APP_URL: 'http://wallet.example.test' },
    { APP_URL: 'https://wallet.example.test/path' },
    { APP_URL: 'https://user:password@wallet.example.test' },
    { APPLE_WALLET_SIGNER_KEY_BASE64: certificates.env.APPLE_WALLET_WWDR_CERT_BASE64 },
    { APPLE_WALLET_SIGNER_KEY_BASE64: certificates.mismatchedKey },
    { APPLE_WALLET_WWDR_CERT_BASE64: certificates.env.APPLE_WALLET_SIGNER_CERT_BASE64 },
    { APPLE_WALLET_SIGNER_CERT_BASE64: 'garbage!' },
  ]) {
    expect(() =>
      api.validateAppleWalletCredentials({ ...certificates.env, ...patch }, [certificates.root]),
    ).toThrow('Wallet is unavailable');
  }
  expect(() =>
    api.validateAppleWalletCredentials(
      certificates.env,
      [certificates.root],
      new Date('2100-01-01'),
    ),
  ).toThrow('Wallet is unavailable');
  expect(() => api.validateAppleWalletCredentials(certificates.env, [])).toThrow(
    'Wallet is unavailable',
  );
  expect(() =>
    api.validateAppleWalletCredentials(
      { ...certificates.env, SESSION_SECRET: certificates.env.APPLE_WALLET_AUTH_SECRET },
      [certificates.root],
    ),
  ).toThrow('Wallet is unavailable');
});

it('creates a detached PKCS7 signature covering the manifest and every required PNG', async () => {
  const api = apple as unknown as Record<string, (...args: unknown[]) => any>;
  expect(typeof api.buildAppleWalletPass).toBe('function');
  const validated = api.validateAppleWalletCredentials(certificates.env, [certificates.root]);
  const assets = Object.fromEntries(
    await Promise.all(
      ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'].map(async (name) => [
        name,
        await readFile(path.join(process.cwd(), 'public/wallet', name)),
      ]),
    ),
  );
  const zipped = await api.buildAppleWalletPass(applePass, appleCard, validated, assets);
  const files = unzipApplePass(zipped);
  const manifest = JSON.parse(files['manifest.json'].toString());
  expect(certificates.verify(files.signature, files['manifest.json'])).toEqual(
    files['manifest.json'],
  );
  for (const name of [
    'pass.json',
    'icon.png',
    'icon@2x.png',
    'icon@3x.png',
    'logo.png',
    'logo@2x.png',
  ]) {
    expect(manifest[name]).toBe(createHash('sha1').update(files[name]).digest('hex'));
  }
  const pass = JSON.parse(files['pass.json'].toString());
  expect(pass).toMatchObject({
    formatVersion: 1,
    serialNumber: 'pass-test-123',
    passTypeIdentifier: 'pass.test.nqta',
    teamIdentifier: 'TESTTEAM01',
    webServiceURL: 'https://wallet.example.test/api/wallet/apple',
    barcodes: [{ format: 'PKBarcodeFormatQR', message: 'NQTA-PUBLIC-QR' }],
  });
  expect(pass.storeCard.primaryFields[0].value).toBe('3 / 5');
  expect(pass.storeCard.headerFields[0].value).toBe(1);
  expect(pass.authenticationToken).toHaveLength(64);
  const text = files['pass.json'].toString();
  for (const privateValue of [
    'PRIVATE CUSTOMER',
    '+212600000001',
    'private-shop',
    'private-programme',
    'private-reward',
    'signer.key',
    'password',
    'session',
    'recovery',
  ])
    expect(text).not.toContain(privateValue);
  expect(text).toContain('https://wallet.example.test/card/private-membership');
  expect(() =>
    api.buildAppleWalletPass(applePass, appleCard, validated, {
      'icon.png': Buffer.from('invalid'),
    }),
  ).toThrow('Wallet is unavailable');
});

it('keeps scoped authorization stable across revisions and rejects cross-pass/browser credentials', async () => {
  const api = apple as unknown as Record<string, (...args: unknown[]) => any>;
  expect(typeof api.appleWalletAuthorization).toBe('function');
  for (const [key, value] of Object.entries(certificates.env)) vi.stubEnv(key, value);
  const validated = api.validateAppleWalletCredentials(certificates.env, [certificates.root]);
  const asset = await readFile(path.join(process.cwd(), 'public/wallet/icon.png'));
  const assets = Object.fromEntries(
    ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'].map((name) => [
      name,
      asset,
    ]),
  );
  const first = JSON.parse(
    unzipApplePass(await api.buildAppleWalletPass(applePass, appleCard, validated, assets))[
      'pass.json'
    ].toString(),
  );
  const revised = JSON.parse(
    unzipApplePass(
      await api.buildAppleWalletPass(
        { ...applePass, revision: '99' },
        { ...appleCard, progress: 4 },
        validated,
        assets,
      ),
    )['pass.json'].toString(),
  );
  expect(revised.authenticationToken).toBe(first.authenticationToken);
  expect(api.appleWalletAuthorization(applePass.id, `ApplePass ${first.authenticationToken}`)).toBe(
    true,
  );
  expect(
    api.appleWalletAuthorization('different-pass', `ApplePass ${first.authenticationToken}`),
  ).toBe(false);
  expect(api.appleWalletAuthorization(applePass.id, `Bearer ${first.authenticationToken}`)).toBe(
    false,
  );
  expect(api.appleWalletAuthorization(applePass.id, 'ApplePass NQTA-PUBLIC-QR')).toBe(false);
  expect(api.appleWalletAuthorization(applePass.id, `Basic ${first.authenticationToken}`)).toBe(
    false,
  );
});

it('voids closed cards without their barcode, customer link or deleted identity', async () => {
  const api = apple as unknown as Record<string, (...args: unknown[]) => any>;
  expect(typeof api.buildAppleWalletPass).toBe('function');
  const validated = api.validateAppleWalletCredentials(certificates.env, [certificates.root]);
  const asset = await readFile(path.join(process.cwd(), 'public/wallet/icon.png'));
  const assets = Object.fromEntries(
    ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'].map((name) => [
      name,
      asset,
    ]),
  );
  const inactive = JSON.parse(
    unzipApplePass(
      await api.buildAppleWalletPass(
        applePass,
        { ...appleCard, status: 'closed' },
        validated,
        assets,
      ),
    )['pass.json'].toString(),
  );
  expect(inactive.voided).toBe(true);
  expect(inactive.barcodes).toBeUndefined();
  expect(JSON.stringify(inactive)).not.toContain('private-membership');
  expect(JSON.stringify(inactive)).not.toContain('NQTA-PUBLIC-QR');
  const paused = JSON.parse(
    unzipApplePass(
      await api.buildAppleWalletPass(
        applePass,
        { ...appleCard, shopStatus: 'paused' },
        validated,
        assets,
      ),
    )['pass.json'].toString(),
  );
  expect(paused.voided).toBe(false);
  expect(JSON.stringify(paused)).toContain('New earning is paused');
  expect(paused.barcodes[0].message).toBe('NQTA-PUBLIC-QR');
});
