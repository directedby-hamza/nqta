import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Database } from '../../src/server/db/client';
import { walletOptions } from '../../src/server/wallet/options';
import { flushWalletUpdates } from '../../src/server/wallet/delivery';
import { POST } from '../../src/app/api/wallet/apple/[...path]/route';

const calls = vi.hoisted(() => ({ database: vi.fn(), google: vi.fn(), apple: vi.fn() }));
vi.mock('../../src/server/db/client', () => ({ getDatabase: calls.database }));
vi.mock('../../src/server/wallet/google', () => ({
  googleWalletOptions: () => true,
  syncGoogleWalletPass: calls.google,
}));
vi.mock('../../src/server/wallet/apple', () => ({
  appleWalletOptions: () => true,
  applePassTypeIdentifier: () => 'pass.org.nqta.loyalty',
  pushAppleWalletUpdates: calls.apple,
}));
beforeEach(() => {
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  calls.database.mockReset().mockRejectedValue(new Error('Database must not be opened.'));
  calls.google.mockReset();
  calls.apple.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it('keeps both providers paused even when their credentials are usable', () => {
  expect(walletOptions()).toEqual({ google: false, apple: false });
});

it('does not consume delivery leases or call providers while paused', async () => {
  const query = vi.fn().mockRejectedValue(new Error('The queue must not be touched.'));
  const db = { query, transaction: query } as unknown as Database;
  expect(await flushWalletUpdates(db)).toEqual({ delivered: 0, failed: 0 });
  expect(query).not.toHaveBeenCalled();
  expect(calls.google).not.toHaveBeenCalled();
  expect(calls.apple).not.toHaveBeenCalled();
});

it('rejects native callbacks before opening a database or doing provider work', async () => {
  const response = await POST(
    new NextRequest('https://nqta.example.org/api/wallet/apple/v1/log', {
      method: 'POST',
      body: JSON.stringify({ logs: [] }),
    }),
    { params: Promise.resolve({ path: ['v1', 'log'] }) },
  );
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(calls.database).not.toHaveBeenCalled();
});
