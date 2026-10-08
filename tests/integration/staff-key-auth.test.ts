import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fixture, owner } from './fixture';
import type { Database } from '../../src/server/db/client';
import { createWorkspace } from '../../src/server/auth/onboarding';
import { createAuthService } from '../../src/server/auth/staff';
import { createStaffRecoveryService } from '../../src/server/auth/recovery';
import { hashToken, id, token } from '../../src/server/auth/crypto';

let db: Database;
beforeAll(async () => {
  db = await fixture();
});
beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('AUTH_MODE', 'recovery-key');
  vi.stubEnv('EMAIL_PROVIDER', 'none');
  vi.stubEnv('APP_URL', 'https://live.nqta.example');
  await db.query('DELETE FROM sessions');
  await db.query('DELETE FROM request_limits');
  await db.query('DELETE FROM login_limits');
  await db.query('DELETE FROM login_attempts');
  await db.query(
    "UPDATE staff SET email_verified=false,active=true WHERE id IN ('owner','cashier','other-owner')",
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await db?.close();
});

function workspace(email: string, slug: string) {
  return createWorkspace(db, {
    name: 'Hana',
    email,
    password: 'OriginalPassword123!',
    shopName: 'Hana Shop',
    slug,
    category: 'Café',
    location: 'Rabat, Morocco',
  });
}

it('creates a live workspace with a password session and saved key without claiming email verification', async () => {
  const result = await workspace('key-owner@test.com', 'key-owner-shop');
  expect(result).toMatchObject({
    token: expect.any(String),
    recoveryKey: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(result.verificationRequired).toBeUndefined();
  const staff = (
    await db.query<{ auth_method: string; email_verified: boolean; recovery_key_hash: string }>(
      "SELECT auth_method,email_verified,recovery_key_hash FROM staff WHERE email='key-owner@test.com'",
    )
  ).rows[0];
  expect(staff).toEqual({
    auth_method: 'recovery-key',
    email_verified: false,
    recovery_key_hash: hashToken((result as { recoveryKey: string }).recoveryKey),
  });
  expect((await db.query('SELECT * FROM staff_email_tokens')).rows).toHaveLength(0);
  expect(await createAuthService(db).getStaffActor(result.token!)).toMatchObject({ role: 'owner' });
});

it('keeps existing unverified contact accounts denied after enabling key mode', async () => {
  const auth = createAuthService(db);
  await expect(auth.signInStaff('owner@test.com', 'CorrectPassword123!')).rejects.toThrow(
    /verify.*email/i,
  );
  const legacySession = token();
  await db.query(
    "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,'owner','staff',NOW()+interval '7 days')",
    [id(), hashToken(legacySession)],
  );
  await expect(auth.getStaffActor(legacySession)).rejects.toThrow(/session/i);
});

it('accepts a direct one-use staff invitation and returns a key without a verified email claim', async () => {
  await db.query("UPDATE staff SET email_verified=true WHERE id='owner'");
  const auth = createAuthService(db);
  const invitation = await auth.inviteStaff(owner, {
    name: 'Key cashier',
    email: 'key-invite@test.com',
    role: 'cashier',
  });
  const result = await auth.acceptStaffInvite(invitation.token, 'InvitedPassword123!');
  expect(result).toEqual({ recoveryKey: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(
    (
      await db.query(
        "SELECT auth_method,email_verified FROM staff WHERE email='key-invite@test.com'",
      )
    ).rows[0],
  ).toEqual({ auth_method: 'recovery-key', email_verified: false });
  const session = await auth.signInStaff('key-invite@test.com', 'InvitedPassword123!');
  expect(await auth.getStaffActor(session)).toMatchObject({ shopId: 'shop', role: 'cashier' });
  await expect(auth.acceptStaffInvite(invitation.token, 'InvitedPassword123!')).rejects.toThrow(
    /invitation/i,
  );
  expect((await db.query('SELECT * FROM staff_email_tokens')).rows).toHaveLength(0);
});

it('keeps email delivery recovery away from key accounts after a mode switch', async () => {
  const result = await workspace('no-mail-key@test.com', 'no-mail-key-shop');
  expect((result as { recoveryKey?: string }).recoveryKey).toBeTruthy();
  vi.stubEnv('AUTH_MODE', 'verified-contact');
  const recovery = createStaffRecoveryService(db);
  expect(await recovery.requestPasswordReset('no-mail-key@test.com')).toEqual({ ok: true });
  expect(await recovery.requestVerification('no-mail-key@test.com')).toEqual({ ok: true });
  expect((await db.query('SELECT * FROM staff_email_tokens')).rows).toHaveLength(0);
});
