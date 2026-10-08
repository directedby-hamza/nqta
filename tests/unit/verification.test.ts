import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deliverVerification } from '../../src/server/providers/verification';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('SMS_PROVIDER', 'twilio');
  vi.stubEnv('TWILIO_ACCOUNT_SID', `AC${'a'.repeat(32)}`);
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'private-fixture-secret');
  vi.stubEnv('TWILIO_FROM_NUMBER', '+15551234567');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('accepts a queued real SMS through the configured HTTPS adapter', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ sid: 'SMqueued', status: 'queued' }), { status: 201 }),
    ),
  );
  await expect(deliverVerification('+212600000099', '123456', false)).resolves.toBeUndefined();
});
it.each(['provider rejection', 'network failure', 'timeout', 'failed message'])(
  'maps %s to a safe retryable delivery error',
  async (failure) => {
    vi.stubGlobal('fetch', async () => {
      if (failure === 'network failure')
        throw new Error('private-fixture-secret transport details');
      if (failure === 'timeout') throw new DOMException('secret timeout', 'TimeoutError');
      if (failure === 'failed message')
        return new Response(JSON.stringify({ sid: 'SMfailed', status: 'failed' }), { status: 201 });
      return new Response('private-fixture-secret provider response', { status: 403 });
    });
    const error = await deliverVerification('+212600000099', '123456', false).catch((e) => e);
    expect(error.status).toBe(503);
    expect(error.message).not.toMatch(/private-fixture-secret|transport details|secret timeout/);
  },
);
