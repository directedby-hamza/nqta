import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAuthService } from '../../src/server/auth/staff';
import { fixture, owner, cashier } from './fixture';
import type { Database } from '../../src/server/db/client';
import { RateLimitError } from '../../src/server/auth/rate-limit';
let db: Database;
let auth: ReturnType<typeof createAuthService>;
beforeEach(async () => {
  db = await fixture();
  auth = createAuthService(db);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db?.close();
});
it('normalises staff email and authenticates a correct password', async () => {
  const token = await auth.signInStaff(' OWNER@TEST.COM ', 'CorrectPassword123!');
  expect(await auth.getStaffActor(token)).toMatchObject(owner);
});
it('rejects wrong credentials without issuing a session', async () => {
  await expect(auth.signInStaff('owner@test.com', 'wrong')).rejects.toThrow(/credentials/i);
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(0);
});
it('concurrent incorrect sign-ins reserve only ten credential checks', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 15 }, () => auth.signInStaff('owner@test.com', 'wrong')),
  );
  const errors = results.map((result) =>
    result.status === 'rejected' ? result.reason.message : 'unexpected session',
  );
  expect(errors.filter((message) => /credentials/.test(message))).toHaveLength(10);
  expect(errors.filter((message) => /Too many/.test(message))).toHaveLength(5);
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(0);
});
it('staff sign-in limits provide a retryable 429 with the remaining wait', async () => {
  for (let attempt = 0; attempt < 10; attempt++)
    await expect(auth.signInStaff('owner@test.com', 'wrong')).rejects.toThrow(/credentials/i);
  await db.query("UPDATE login_limits SET window_started=NOW()-interval '14 minutes'");
  const rejected = await auth
    .signInStaff('owner@test.com', 'CorrectPassword123!')
    .catch((error: unknown) => error);
  expect(rejected).toBeInstanceOf(RateLimitError);
  expect(rejected).toMatchObject({ status: 429 });
  expect((rejected as RateLimitError).retryAfterSeconds).toBeGreaterThan(0);
  expect((rejected as RateLimitError).retryAfterSeconds).toBeLessThanOrEqual(60);
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(0);
  await db.query("UPDATE login_limits SET window_started=NOW()-interval '16 minutes'");
  expect(
    await auth.getStaffActor(await auth.signInStaff('owner@test.com', 'CorrectPassword123!')),
  ).toMatchObject(owner);
});
it('expired staff sessions do not authorise actions', async () => {
  const token = await auth.signInStaff('owner@test.com', 'CorrectPassword123!');
  await db.query("UPDATE sessions SET expires_at=NOW()-interval '1 minute'");
  await expect(auth.getStaffActor(token)).rejects.toThrow(/sign in|session/i);
});
it('staff revocation invalidates existing sessions', async () => {
  const token = await auth.signInStaff('cashier@test.com', 'CorrectPassword123!');
  await auth.revokeStaff(owner, 'cashier');
  await expect(auth.getStaffActor(token)).rejects.toThrow(/sign in|access|session/i);
});
it('cashiers cannot invite or revoke staff', async () => {
  await expect(
    auth.inviteStaff(cashier, { name: 'New', email: 'new@test.com', role: 'cashier' }),
  ).rejects.toThrow(/owner/i);
  await expect(auth.revokeStaff(cashier, 'owner')).rejects.toThrow(/owner/i);
});
it('owner cannot revoke staff belonging to another shop', async () => {
  await expect(auth.revokeStaff(owner, 'other-owner')).rejects.toThrow(/not found|access/i);
});
it('single-use staff invitations create an individual cashier account', async () => {
  const invitation = await auth.inviteStaff(owner, {
    name: 'Sara',
    email: 'sara@test.com',
    role: 'cashier',
  });
  await auth.acceptStaffInvite(invitation.token, 'NewPassword123!');
  await expect(auth.acceptStaffInvite(invitation.token, 'NewPassword123!')).rejects.toThrow(
    /invitation/i,
  );
  expect(
    await auth.getStaffActor(await auth.signInStaff('sara@test.com', 'NewPassword123!')),
  ).toMatchObject({ shopId: 'shop', role: 'cashier' });
});
it('live production requires staff to verify their email before signing in', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  await expect(auth.signInStaff('owner@test.com', 'CorrectPassword123!')).rejects.toThrow(
    /verify.*email/i,
  );
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(0);
});
it('live production refuses an existing session belonging to unverified staff', async () => {
  const token = await auth.signInStaff('owner@test.com', 'CorrectPassword123!');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  await expect(auth.getStaffActor(token)).rejects.toThrow(/verify.*email|session/i);
});
it('live production refuses the public demo credentials and their existing sessions', async () => {
  await db.query("UPDATE staff SET email='owner@nqta.demo' WHERE id='owner'");
  const token = await auth.signInStaff('owner@nqta.demo', 'CorrectPassword123!');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  await expect(auth.signInStaff('owner@nqta.demo', 'CorrectPassword123!')).rejects.toThrow(
    /credentials|unavailable/i,
  );
  await expect(auth.getStaffActor(token)).rejects.toThrow(/session|unavailable/i);
});
