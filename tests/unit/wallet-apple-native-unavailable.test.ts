import { afterEach, expect, it, vi } from 'vitest';
import type { Database } from '../../src/server/db/client';

afterEach(() => vi.unstubAllEnvs());

it('returns safe unavailable for native callbacks when genuine Apple signing is absent', async () => {
  vi.stubEnv('APPLE_WALLET_SIGNER_CERT_BASE64', '');
  const module = await import('../../src/server/wallet/apple-web-service').catch(() => undefined);
  const service = module?.createAppleWebService({} as Database);
  const response = await service?.(
    new Request('https://wallet.example.test/api/wallet/apple/v1/log', {
      method: 'POST',
      body: '{"logs":[]}',
    }),
    ['v1', 'log'],
  );
  expect(response?.status).toBe(503);
});
