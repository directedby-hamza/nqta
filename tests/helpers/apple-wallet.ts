// SYNTHETIC TEST-ONLY certificates. These are never trusted by the default adapter.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { X509Certificate } from 'node:crypto';
import type { MembershipCard } from '../../src/server/loyalty/types';
import type { WalletPass } from '../../src/server/wallet/contracts';

export const applePass: WalletPass = {
  id: 'pass-test-123',
  membershipId: 'private-membership',
  provider: 'apple',
  externalId: 'pass.test.nqta',
  revision: '12',
  syncedRevision: '0',
  updatedAt: '2026-10-08T12:00:00.250Z',
};
export const appleCard: MembershipCard = {
  id: 'private-membership',
  memberCode: 'NQTA-PUBLIC-QR',
  name: 'PRIVATE CUSTOMER',
  phone: '+212600000001',
  shopId: 'private-shop',
  shopName: 'Test Coffee',
  shopSlug: 'coffee',
  theme: '#24554a',
  location: 'Rabat',
  programmeId: 'private-programme',
  threshold: 5,
  rewardDescription: 'A coffee',
  eligibility: 'One paid coffee',
  terms: 'Confirm rewards in Nqta.',
  progress: 3,
  totalStamps: 8,
  rewards: [
    { id: 'private-reward', description: 'A coffee', state: 'available', createdAt: '2026-10-08' },
  ],
  needsReview: false,
  status: 'active',
  shopStatus: 'active',
};

export function testOnlyAppleCertificates() {
  const directory = mkdtempSync(path.join(tmpdir(), 'nqta-apple-test-only-'));
  const file = (name: string) => path.join(directory, name);
  const openssl = (...args: string[]) => execFileSync('openssl', args, { stdio: 'pipe' });
  writeFileSync(
    file('ca.ext'),
    'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign',
  );
  writeFileSync(
    file('leaf.ext'),
    'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.1.16=ASN1:UTF8String:pass.test.nqta',
  );
  openssl(
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=SYNTHETIC TEST ONLY ROOT',
    '-keyout',
    file('root.key'),
    '-out',
    file('root.csr'),
  );
  openssl(
    'x509',
    '-req',
    '-in',
    file('root.csr'),
    '-signkey',
    file('root.key'),
    '-set_serial',
    '1',
    '-days',
    '2',
    '-extfile',
    file('ca.ext'),
    '-out',
    file('root.pem'),
  );
  openssl(
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=Apple Worldwide Developer Relations Certification Authority/OU=SYNTHETIC TEST ONLY',
    '-keyout',
    file('wwdr.key'),
    '-out',
    file('wwdr.csr'),
  );
  openssl(
    'x509',
    '-req',
    '-in',
    file('wwdr.csr'),
    '-CA',
    file('root.pem'),
    '-CAkey',
    file('root.key'),
    '-CAcreateserial',
    '-days',
    '2',
    '-extfile',
    file('ca.ext'),
    '-out',
    file('wwdr.pem'),
  );
  openssl(
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/UID=pass.test.nqta/OU=TESTTEAM01/CN=SYNTHETIC TEST ONLY Wallet Pass',
    '-keyout',
    file('signer.key'),
    '-out',
    file('signer.csr'),
  );
  openssl(
    'x509',
    '-req',
    '-in',
    file('signer.csr'),
    '-CA',
    file('wwdr.pem'),
    '-CAkey',
    file('wwdr.key'),
    '-CAcreateserial',
    '-days',
    '2',
    '-extfile',
    file('leaf.ext'),
    '-out',
    file('signer.pem'),
  );
  const env = {
    APP_URL: 'https://wallet.example.test',
    APPLE_WALLET_PASS_TYPE_ID: 'pass.test.nqta',
    APPLE_WALLET_TEAM_ID: 'TESTTEAM01',
    APPLE_WALLET_AUTH_SECRET: 'SYNTHETIC-TEST-ONLY-auth-secret-at-least-32-characters',
    APPLE_WALLET_SIGNER_CERT_BASE64: readFileSync(file('signer.pem')).toString('base64'),
    APPLE_WALLET_SIGNER_KEY_BASE64: readFileSync(file('signer.key')).toString('base64'),
    APPLE_WALLET_WWDR_CERT_BASE64: readFileSync(file('wwdr.pem')).toString('base64'),
  };
  return {
    directory,
    env,
    root: new X509Certificate(readFileSync(file('root.pem'))),
    mismatchedKey: readFileSync(file('root.key')).toString('base64'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    verify: (signature: Buffer, manifest: Buffer) => {
      writeFileSync(file('signature.der'), signature);
      writeFileSync(file('manifest.json'), manifest);
      openssl(
        'cms',
        '-verify',
        '-binary',
        '-inform',
        'DER',
        '-in',
        file('signature.der'),
        '-content',
        file('manifest.json'),
        '-noverify',
        '-out',
        file('verified.json'),
      );
      return readFileSync(file('verified.json'));
    },
  };
}

export function unzipApplePass(zip: Buffer): Record<string, Buffer> {
  const entries: Record<string, Buffer> = {};
  for (let offset = 0; offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50;) {
    const compression = zip.readUInt16LE(offset + 8);
    const length = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    const content = zip.subarray(start, start + length);
    entries[name] = compression === 8 ? inflateRawSync(content) : content;
    offset = start + length;
  }
  return entries;
}
