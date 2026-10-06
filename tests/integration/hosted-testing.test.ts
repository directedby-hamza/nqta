import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCustomerService } from '../../src/server/auth/customer';
import { fixture } from './fixture';
import type { Database } from '../../src/server/db/client';

let db: Database;
beforeEach(async () => {
  db = await fixture();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db?.close();
});

function configureHostedTest() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'true');
  vi.stubEnv('APP_URL', 'https://nqta-test.onrender.com');
  vi.stubEnv('DATABASE_URL', 'postgresql://test:unused@example.com/test');
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-longer-than-32-characters');
  vi.stubEnv('TEST_ACCESS_PASSWORD', 'test-site-password-longer-than-16');
}

it('explicit password-protected hosted testing can verify and recover a customer in production', async () => {
  configureHostedTest();
  const customer = createCustomerService(db, { development: true });
  const code = await customer.requestVerification('+212600000099');
  expect(code.developmentCode).toMatch(/^\d{6}$/);
  const identity = await customer.verifyCode(code.challengeId, code.developmentCode!);
  const member = await customer.joinProgramme(identity.customerId, 'programme', 'Test person', {
    sms: false,
    whatsapp: false,
  });
  const recovery = await customer.requestVerification('+212600000099');
  const recovered = await customer.verifyCode(recovery.challengeId, recovery.developmentCode!);
  expect(recovered.customerId).toBe(identity.customerId);
  expect((await customer.getCard(recovered.customerId, member.id)).memberCode).toMatch(/^NQ-/);
});

it('ordinary production refuses simulated verification even when DEMO_MODE is true', async () => {
  configureHostedTest();
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('DEMO_MODE', 'true');
  vi.stubEnv('SMS_PROVIDER', '');
  const customer = createCustomerService(db, { development: true });
  await expect(customer.requestVerification('+212600000098')).rejects.toThrow(
    /provider|configured/i,
  );
});

it('hosted testing without its access password fails closed before issuing a customer code', async () => {
  configureHostedTest();
  vi.stubEnv('TEST_ACCESS_PASSWORD', '');
  const customer = createCustomerService(db, { development: true });
  await expect(customer.requestVerification('+212600000097')).rejects.toThrow(
    /TEST_ACCESS_PASSWORD/,
  );
  expect((await db.query('SELECT id FROM verification_challenges')).rows).toHaveLength(0);
});
