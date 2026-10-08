import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fixture } from './fixture';
import type { Database } from '../../src/server/db/client';
import { createWorkspace } from '../../src/server/auth/onboarding';
import { createAuthService } from '../../src/server/auth/staff';
import { createStaffKeyRecoveryService } from '../../src/server/auth/staff-key-recovery';
import { hashToken, verifyPassword } from '../../src/server/auth/crypto';
import { RateLimitError } from '../../src/server/auth/rate-limit';

let db: Database;
let email: string;
let recoveryKey: string;
let session: string;
let staffId: string;
let suffix = 0;
beforeAll(async () => {
  db = await fixture();
});
beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('AUTH_MODE', 'recovery-key');
  vi.stubEnv('EMAIL_PROVIDER', 'none');
  await db.query('DELETE FROM sessions');
  await db.query('DELETE FROM request_limits');
  await db.query('DELETE FROM login_limits');
  await db.query('DELETE FROM login_attempts');
  email = `recover-key-${++suffix}@test.com`;
  const result = await createWorkspace(db, {
    name: 'Hana',
    email,
    password: 'OriginalPassword123!',
    shopName: 'Key Shop',
    slug: `recover-key-${suffix}`,
    category: 'Café',
    location: 'Rabat, Morocco',
  });
  recoveryKey = result.recoveryKey!;
  session = result.token!;
  staffId = (await db.query<{ id: string }>('SELECT id FROM staff WHERE email=$1', [email])).rows[0]
    .id;
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await db?.close();
});

it('rotates a consumed key and password atomically and revokes every previous staff session', async () => {
  const auth = createAuthService(db);
  const second = await auth.signInStaff(email, 'OriginalPassword123!');
  const result = await createStaffKeyRecoveryService(db).resetPassword(
    ` ${email.toUpperCase()} `,
    recoveryKey,
    'ChangedPassword123!',
  );
  expect(result.recoveryKey).toMatch(/^[a-f0-9]{64}$/);
  expect(result.recoveryKey).not.toBe(recoveryKey);
  const stored = (
    await db.query<{ recovery_key_hash: string; password_hash: string; email_verified: boolean }>(
      'SELECT recovery_key_hash,password_hash,email_verified FROM staff WHERE id=$1',
      [staffId],
    )
  ).rows[0];
  expect(stored.recovery_key_hash).toBe(hashToken(result.recoveryKey));
  expect(verifyPassword('ChangedPassword123!', stored.password_hash)).toBe(true);
  expect(stored.email_verified).toBe(false);
  await expect(auth.getStaffActor(session)).rejects.toThrow(/session/i);
  await expect(auth.getStaffActor(second)).rejects.toThrow(/session/i);
  await expect(auth.signInStaff(email, 'OriginalPassword123!')).rejects.toThrow(/credentials/i);
  expect(
    await auth.getStaffActor(await auth.signInStaff(email, 'ChangedPassword123!')),
  ).toMatchObject({ userId: staffId });
  await expect(
    createStaffKeyRecoveryService(db).resetPassword(email, recoveryKey, 'ReplayPassword123!'),
  ).rejects.toThrow('The recovery credentials are incorrect.');
});

it('allows only one concurrent use of a staff recovery key', async () => {
  const results = await Promise.allSettled([
    createStaffKeyRecoveryService(db).resetPassword(email, recoveryKey, 'FirstPassword123!'),
    createStaffKeyRecoveryService(db).resetPassword(email, recoveryKey, 'SecondPassword123!'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(
    (await db.query("SELECT id FROM sessions WHERE principal_id=$1 AND kind='staff'", [staffId]))
      .rows,
  ).toHaveLength(0);
});

it('returns the same invalid credentials message for unknown accounts, wrong keys and contact accounts', async () => {
  for (const [identity, key] of [
    ['missing@test.com', recoveryKey],
    [email, '0'.repeat(64)],
    ['owner@test.com', recoveryKey],
    [email, 'invalid'],
  ]) {
    await expect(
      createStaffKeyRecoveryService(db).resetPassword(identity, key, 'ChangedPassword123!'),
    ).rejects.toThrow('The recovery credentials are incorrect.');
  }
  expect(await createAuthService(db).getStaffActor(session)).toMatchObject({ userId: staffId });
});

it('cannot revive revoked staff or staff whose shop is inactive', async () => {
  await db.query('UPDATE staff SET active=false WHERE id=$1', [staffId]);
  await expect(
    createStaffKeyRecoveryService(db).resetPassword(email, recoveryKey, 'ChangedPassword123!'),
  ).rejects.toThrow('The recovery credentials are incorrect.');
  await db.query('UPDATE staff SET active=true WHERE id=$1', [staffId]);
  await db.query(
    "UPDATE shops SET status='inactive' WHERE id=(SELECT shop_id FROM staff WHERE id=$1)",
    [staffId],
  );
  await expect(
    createStaffKeyRecoveryService(db).resetPassword(email, recoveryKey, 'ChangedPassword123!'),
  ).rejects.toThrow('The recovery credentials are incorrect.');
});

it('preserves old credentials and sessions when the replacement password violates policy', async () => {
  await expect(
    createStaffKeyRecoveryService(db).resetPassword(email, recoveryKey, 'short'),
  ).rejects.toThrow(/10–200/);
  expect(await createAuthService(db).getStaffActor(session)).toMatchObject({ userId: staffId });
  expect(
    (
      await db.query<{ recovery_key_hash: string }>(
        'SELECT recovery_key_hash FROM staff WHERE id=$1',
        [staffId],
      )
    ).rows[0].recovery_key_hash,
  ).toBe(hashToken(recoveryKey));
  await expect(
    createStaffKeyRecoveryService(db).resetPassword(email, recoveryKey, 'ChangedPassword123!'),
  ).resolves.toMatchObject({ recoveryKey: expect.any(String) });
});

it('enforces a durable account recovery limit across fresh service instances', async () => {
  for (let attempt = 0; attempt < 5; attempt++)
    await expect(
      createStaffKeyRecoveryService(db).resetPassword(email, '0'.repeat(64), 'ChangedPassword123!'),
    ).rejects.toThrow('The recovery credentials are incorrect.');
  await expect(
    createStaffKeyRecoveryService(db).resetPassword(email, recoveryKey, 'ChangedPassword123!'),
  ).rejects.toBeInstanceOf(RateLimitError);
  expect(
    (await db.query<{ bucket: string }>('SELECT bucket FROM request_limits')).rows.every(
      (row) => !row.bucket.includes(email),
    ),
  ).toBe(true);
  await db.query(
    "UPDATE request_limits SET window_started=NOW()-interval '16 minutes' WHERE attempts=5",
  );
  await expect(
    createStaffKeyRecoveryService(db).resetPassword(email, recoveryKey, 'ChangedPassword123!'),
  ).resolves.toMatchObject({ recoveryKey: expect.any(String) });
});
