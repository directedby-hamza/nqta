import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixture } from './fixture';
import type { Database } from '../../src/server/db/client';
import { createCustomerService } from '../../src/server/auth/customer';
let db: Database;
beforeEach(async () => {
  db = await fixture();
  for (const [key, value] of Object.entries({
    NODE_ENV: 'production',
    HOSTED_TEST_MODE: 'false',
    DEMO_MODE: 'false',
    SESSION_SECRET: 'production-fixture-secret-longer-than-32',
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
    TWILIO_AUTH_TOKEN: 'fixture-secret-not-live',
    TWILIO_FROM_NUMBER: '+15551234567',
    SMS_ALLOWED_PREFIXES: '212',
    SMS_DAILY_LIMIT: '2',
  }))
    vi.stubEnv(key, value);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db.close();
});
it('delivers a production code without disclosing it even when development is requested', async () => {
  let delivered = '';
  vi.stubGlobal('fetch', async (_: unknown, input: RequestInit) => {
    delivered = new URLSearchParams(String(input.body)).get('Body')!.match(/\d{6}/)![0];
    return new Response(JSON.stringify({ sid: 'SMfixture', status: 'queued' }), { status: 201 });
  });
  const service = createCustomerService(db, { development: true });
  const response = await service.requestVerification('+212600000099');
  expect(response.developmentCode).toBeUndefined();
  expect(delivered).toMatch(/^\d{6}$/);
  const identity = await service.verifyCode(response.challengeId, delivered);
  expect(identity.customerId).toBeTruthy();
});
it('rejects destinations outside the configured launch country before paid delivery', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(createCustomerService(db).requestVerification('+15551234567')).rejects.toThrow(
    /country|supported|available/i,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it('enforces one atomic daily ceiling across varied destinations and concurrent requests', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ sid: 'SMfixture', status: 'queued' }), { status: 201 }),
  );
  vi.stubGlobal('fetch', fetcher);
  const service = createCustomerService(db);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) => service.requestVerification(`+21260000010${i}`)),
  );
  expect(outcomes.filter((v) => v.status === 'fulfilled')).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const denied = outcomes.find((v) => v.status === 'rejected') as PromiseRejectedResult;
  expect(denied.reason.status).toBe(429);
  expect(denied.reason.retryAfterSeconds).toBeGreaterThan(0);
});
it('records no verification challenge when the actual SMS provider fails', async () => {
  vi.stubGlobal('fetch', async () => new Response('private provider detail', { status: 503 }));
  await expect(
    createCustomerService(db).requestVerification('+212600000099'),
  ).rejects.toMatchObject({ status: 503 });
  expect((await db.query('SELECT id FROM verification_challenges')).rows).toHaveLength(0);
});
