import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as apple from '../../src/server/wallet/apple';
import { testOnlyAppleCertificates } from '../helpers/apple-wallet';

let certificates: ReturnType<typeof testOnlyAppleCertificates>;
beforeAll(() => {
  certificates = testOnlyAppleCertificates();
});
afterAll(() => certificates.cleanup());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// Only the external HTTP/2 transport is replaced. Credentials, bounded requests,
// response classification and timeout handling use the real adapter.
function transport(statuses: [number, string][], hang = false) {
  const session = new EventEmitter() as EventEmitter & {
    request: (headers: unknown) => unknown;
    destroy: () => void;
  };
  const requests: { headers: Record<string, string>; payload?: string }[] = [];
  let destroyed = false;
  session.destroy = () => {
    destroyed = true;
    session.emit('close');
  };
  session.request = (headers: unknown) => {
    const index = requests.length;
    const recorded = {
      headers: headers as Record<string, string>,
      payload: undefined as string | undefined,
    };
    requests.push(recorded);
    const stream = new EventEmitter() as EventEmitter & {
      setEncoding: () => void;
      end: (body: string) => void;
      close: () => void;
    };
    stream.setEncoding = () => {};
    stream.close = () => stream.emit('close');
    stream.end = (payload) => {
      recorded.payload = payload;
      if (!hang)
        queueMicrotask(() => {
          stream.emit('response', { ':status': statuses[index][0] });
          stream.emit('data', statuses[index][1]);
          stream.emit('end');
        });
    };
    return stream;
  };
  let endpoint = '';
  const open = (url: string) => {
    endpoint = url;
    return session;
  };
  return {
    open,
    requests,
    get endpoint() {
      return endpoint;
    },
    get destroyed() {
      return destroyed;
    },
  };
}

it('sends empty refreshes only to fixed production APNs and removes invalid/unregistered tokens', async () => {
  const api = apple as unknown as Record<string, (...args: unknown[]) => any>;
  expect(typeof api.sendAppleWalletUpdates).toBe('function');
  const config = api.validateAppleWalletCredentials(certificates.env, [certificates.root]);
  const fake = transport([
    [200, ''],
    [410, '{"reason":"Unregistered"}'],
    [400, '{"reason":"BadDeviceToken"}'],
    [500, '{"reason":"InternalServerError"}'],
  ]);
  const tokens = ['aa', 'bb', 'cc', 'dd'].map((prefix) => prefix.repeat(32));
  expect(
    await api.sendAppleWalletUpdates([...tokens, tokens[0], '../unsafe'], config, fake.open),
  ).toEqual([
    { token: tokens[0], status: 'sent' },
    { token: tokens[1], status: 'remove' },
    { token: tokens[2], status: 'remove' },
    { token: tokens[3], status: 'retry' },
    { token: '../unsafe', status: 'remove' },
  ]);
  expect(fake.endpoint).toBe('https://api.push.apple.com');
  expect(fake.destroyed).toBe(true);
  for (let index = 0; index < fake.requests.length; index++) {
    expect(fake.requests[index].headers[':path']).toBe('/3/device/' + tokens[index]);
    expect(fake.requests[index].headers['apns-topic']).toBe('pass.test.nqta');
    expect(fake.requests[index].payload).toBe('{}');
  }
});

it('bounds refresh fanout and resolves stalled connections as retries within five seconds', async () => {
  const api = apple as unknown as Record<string, (...args: unknown[]) => any>;
  expect(typeof api.sendAppleWalletUpdates).toBe('function');
  const config = api.validateAppleWalletCredentials(certificates.env, [certificates.root]);
  vi.useFakeTimers();
  const fake = transport([], true);
  const tokens = Array.from({ length: 70 }, (_, index) => index.toString(16).padStart(64, '0'));
  const pending = api.sendAppleWalletUpdates(tokens, config, fake.open);
  await vi.advanceTimersByTimeAsync(5000);
  const results = await pending;
  expect(fake.requests).toHaveLength(64);
  expect(fake.destroyed).toBe(true);
  expect(results).toHaveLength(70);
  expect(results.every((result: { status: string }) => result.status === 'retry')).toBe(true);
});

it('reports retry safely when the default genuine provider is unavailable', async () => {
  const api = apple as unknown as Record<string, (...args: unknown[]) => any>;
  expect(typeof api.pushAppleWalletUpdates).toBe('function');
  vi.stubEnv('APPLE_WALLET_SIGNER_CERT_BASE64', '');
  expect(await api.pushAppleWalletUpdates(['ab'.repeat(32)])).toEqual([
    { token: 'ab'.repeat(32), status: 'retry' },
  ]);
});

it('keeps oversized provider responses and connection failures retryable without emitting secrets', async () => {
  const api = apple as unknown as Record<string, (...args: unknown[]) => any>;
  const config = api.validateAppleWalletCredentials(certificates.env, [certificates.root]);
  const token = 'ab'.repeat(32);
  const fake = transport([[200, 'x'.repeat(4096)]]);
  expect(await api.sendAppleWalletUpdates([token], config, fake.open)).toEqual([
    { token, status: 'retry' },
  ]);
  const failed = transport([], true);
  const pending = api.sendAppleWalletUpdates([token], config, failed.open);
  // Transport failures must resolve all pending notifications rather thanthrow.
  queueMicrotask(() => {
    (failed.open('https://api.push.apple.com') as EventEmitter).emit(
      'error',
      new Error('Network unavailable'),
    );
  });
  expect(await pending).toEqual([{ token, status: 'retry' }]);
});
