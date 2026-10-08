import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fixture, owner } from './fixture';
import type { Database } from '../../src/server/db/client';
import { createAuthService } from '../../src/server/auth/staff';
import { createStaffRecoveryService } from '../../src/server/auth/recovery';
import { reserveLimit, RateLimitError } from '../../src/server/auth/rate-limit';
import { createWorkspace } from '../../src/server/auth/onboarding';
import { hashPassword } from '../../src/server/auth/crypto';
import * as cryptoHelpers from '../../src/server/auth/crypto';
import { checkForDemoData } from '../../src/server/db/check';

let db: Database;
let originalPassword: string;
let delivered: Array<{ to: string[]; text: string }>;
beforeAll(async () => {
  db = await fixture();
  originalPassword = await hashPassword('CorrectPassword123!');
});
beforeEach(async () => {
  await db.query('DELETE FROM staff_email_tokens');
  await db.query('DELETE FROM sessions');
  await db.query('DELETE FROM request_limits');
  await db.query('DELETE FROM login_limits');
  await db.query('DELETE FROM login_attempts');
  await db.query('UPDATE staff SET email_verified=false,password_hash=$1', [originalPassword]);
  await db.query(
    "UPDATE staff SET active=true,email=id || '@test.com' WHERE id IN ('owner','cashier','other-owner')",
  );
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('APP_URL', 'https://live.nqta.example');
  vi.stubEnv('EMAIL_PROVIDER', 'resend');
  vi.stubEnv('RESEND_API_KEY', 'fake-test-key');
  vi.stubEnv('EMAIL_FROM', 'Nqta <hello@nqta.example>');
  delivered = [];
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    delivered.push(JSON.parse(String(init.body)));
    return Response.json({ id: 'fake-message' }, { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await db?.close();
});
function recovery() {
  return createStaffRecoveryService(db);
}
function deliveredToken(index = delivered.length - 1) {
  const url = delivered[index].text.match(/https:\/\/live\.nqta\.example\/[^\s]+/)?.[0];
  expect(url).toBeTruthy();
  return new URL(url!).searchParams.get('token')!;
}

it('rejects an unknown reset token before performing expensive password hashing', async () => {
  const hash = vi.spyOn(cryptoHelpers, 'hashPassword');
  try {
    await expect(recovery().resetPassword('0'.repeat(64), 'ChangedPassword123!')).rejects.toThrow(
      /invalid|expired|used/i,
    );
    expect(hash).not.toHaveBeenCalled();
  } finally {
    hash.mockRestore();
  }
});

it('rejects an unknown invitation before performing expensive password hashing', async () => {
  const hash = vi.spyOn(cryptoHelpers, 'hashPassword');
  try {
    await expect(
      createAuthService(db).acceptStaffInvite('0'.repeat(64), 'ChangedPassword123!'),
    ).rejects.toThrow(/invitation/i);
    expect(hash).not.toHaveBeenCalled();
  } finally {
    hash.mockRestore();
  }
});

it('live verification sends a hashed identity link without returning it to the requester', async () => {
  const result = await recovery().requestVerification(' OWNER@TEST.COM ');
  expect(result).toEqual({ ok: true });
  expect(delivered[0].to).toEqual(['owner@test.com']);
  expect(delivered[0].text).toContain('https://live.nqta.example/verify-email?token=');
  const stored = await db.query<{ token_hash: string }>(
    'SELECT token_hash FROM staff_email_tokens',
  );
  expect(stored.rows).toHaveLength(1);
  expect(stored.rows[0].token_hash).not.toContain(deliveredToken());
});
it('verification proves mailbox ownership and creates exactly one usable staff session', async () => {
  await recovery().requestVerification('owner@test.com');
  const secret = deliveredToken();
  const result = await recovery().verifyEmail(secret);
  expect(await createAuthService(db).getStaffActor(result.token)).toMatchObject(owner);
  await expect(recovery().verifyEmail(secret)).rejects.toThrow(/expired|used|invalid/i);
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(1);
});
it('expired verification links do not verify an account or create a session', async () => {
  await recovery().requestVerification('owner@test.com');
  await db.query("UPDATE staff_email_tokens SET expires_at=NOW()-interval '1 minute'");
  await expect(recovery().verifyEmail(deliveredToken())).rejects.toThrow(/expired|invalid/i);
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(0);
  expect(
    (
      await db.query<{ email_verified: boolean }>(
        "SELECT email_verified FROM staff WHERE id='owner'",
      )
    ).rows[0].email_verified,
  ).toBe(false);
});
it('concurrent uses of one verification link create only one session', async () => {
  await recovery().requestVerification('owner@test.com');
  const secret = deliveredToken();
  const attempts = await Promise.allSettled([
    recovery().verifyEmail(secret),
    recovery().verifyEmail(secret),
  ]);
  expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(1);
});
it('a newer verification link replaces earlier unconsumed links', async () => {
  await recovery().requestVerification('owner@test.com');
  const previous = deliveredToken();
  await recovery().requestVerification('owner@test.com');
  await expect(recovery().verifyEmail(previous)).rejects.toThrow(/expired|used|invalid/i);
  const result = await recovery().verifyEmail(deliveredToken());
  expect(await createAuthService(db).getStaffActor(result.token)).toMatchObject(owner);
});
it('password reset requests give the same public response for known and unknown emails', async () => {
  expect(await recovery().requestPasswordReset('owner@test.com')).toEqual({ ok: true });
  expect(await recovery().requestPasswordReset('missing@test.com')).toEqual({ ok: true });
  expect(delivered).toHaveLength(1);
  expect(delivered[0].text).toContain('/reset-password?token=');
});
it('password reset replaces the password and revokes every existing staff session', async () => {
  await db.query("UPDATE staff SET email_verified=true WHERE id='owner'");
  const auth = createAuthService(db);
  const first = await auth.signInStaff('owner@test.com', 'CorrectPassword123!');
  const second = await auth.signInStaff('owner@test.com', 'CorrectPassword123!');
  await recovery().requestPasswordReset('owner@test.com');
  const secret = deliveredToken();
  await recovery().resetPassword(secret, 'NewPassword123!');
  await expect(auth.getStaffActor(first)).rejects.toThrow(/session/i);
  await expect(auth.getStaffActor(second)).rejects.toThrow(/session/i);
  await expect(auth.signInStaff('owner@test.com', 'CorrectPassword123!')).rejects.toThrow(
    /credentials/i,
  );
  expect(
    await auth.getStaffActor(await auth.signInStaff('owner@test.com', 'NewPassword123!')),
  ).toMatchObject(owner);
  await expect(recovery().resetPassword(secret, 'AnotherPassword123!')).rejects.toThrow(
    /expired|used|invalid/i,
  );
});
it('expired reset links and verification links cannot replace a password', async () => {
  await recovery().requestVerification('owner@test.com');
  await expect(recovery().resetPassword(deliveredToken(), 'NewPassword123!')).rejects.toThrow(
    /expired|invalid/i,
  );
  await recovery().requestPasswordReset('owner@test.com');
  await db.query(
    "UPDATE staff_email_tokens SET expires_at=NOW()-interval '1 minute' WHERE kind='reset'",
  );
  await expect(recovery().resetPassword(deliveredToken(), 'NewPassword123!')).rejects.toThrow(
    /expired|invalid/i,
  );
});
it('concurrent password resets consume a single reset link once', async () => {
  await recovery().requestPasswordReset('owner@test.com');
  const secret = deliveredToken();
  const results = await Promise.allSettled([
    recovery().resetPassword(secret, 'FirstPassword123!'),
    recovery().resetPassword(secret, 'SecondPassword123!'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect((await db.query('SELECT * FROM staff_email_tokens WHERE used=false')).rows).toHaveLength(
    0,
  );
});
it('reserved demo emails cannot create live workspaces or poison production startup', async () => {
  await expect(
    createWorkspace(db, {
      name: 'Reserved owner',
      email: 'PUBLIC@NQTA.DEMO',
      password: 'StrongPassword123!',
      shopName: 'Reserved shop',
      slug: 'reserved-demo-shop',
      category: 'Café',
      location: 'Rabat, Morocco',
    }),
  ).rejects.toThrow(/email|reserved|production/i);
  expect(
    (await db.query("SELECT id FROM shops WHERE slug='reserved-demo-shop'")).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("SELECT id FROM staff WHERE lower(email) LIKE '%@nqta.demo'")).rows,
  ).toHaveLength(0);
  expect((await db.query('SELECT * FROM staff_email_tokens')).rows).toHaveLength(0);
  expect(delivered).toHaveLength(0);
  await expect(checkForDemoData(db)).resolves.toBeUndefined();
});
it('reserved demo emails cannot receive new live staff invitations', async () => {
  await db.query("UPDATE staff SET email_verified=true WHERE id='owner'");
  await expect(
    createAuthService(db).inviteStaff(owner, {
      name: 'Reserved cashier',
      email: 'CASHIER@NQTA.DEMO',
      role: 'cashier',
    }),
  ).rejects.toThrow(/email|reserved|production/i);
  expect(
    (await db.query("SELECT id FROM staff_invitations WHERE lower(email) LIKE '%@nqta.demo'")).rows,
  ).toHaveLength(0);
  expect((await db.query('SELECT * FROM staff_email_tokens')).rows).toHaveLength(0);
  await expect(checkForDemoData(db)).resolves.toBeUndefined();
});
it('reserved demo emails on legacy invitations cannot create live staff or poison production startup', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  const auth = createAuthService(db);
  const invitation = await auth.inviteStaff(owner, {
    name: 'Legacy cashier',
    email: 'legacy@nqta.demo',
    role: 'cashier',
  });
  vi.stubEnv('NODE_ENV', 'production');
  await expect(auth.acceptStaffInvite(invitation.token, 'NewPassword123!')).rejects.toThrow(
    /email|reserved|production/i,
  );
  expect(
    (await db.query("SELECT id FROM staff WHERE lower(email) LIKE '%@nqta.demo'")).rows,
  ).toHaveLength(0);
  expect((await db.query('SELECT * FROM staff_email_tokens')).rows).toHaveLength(0);
  expect(
    (
      await db.query<{ used: boolean }>(
        "SELECT used FROM staff_invitations WHERE email='legacy@nqta.demo'",
      )
    ).rows[0].used,
  ).toBe(false);
  expect(delivered).toHaveLength(0);
  await expect(checkForDemoData(db)).resolves.toBeUndefined();
});
it('revoked staff and synthetic demo accounts cannot recover live access', async () => {
  await db.query("UPDATE staff SET active=false WHERE id='cashier'");
  await db.query("UPDATE staff SET email='other@nqta.demo' WHERE id='other-owner'");
  expect(await recovery().requestPasswordReset('cashier@test.com')).toEqual({ ok: true });
  expect(await recovery().requestVerification('other@nqta.demo')).toEqual({ ok: true });
  expect(delivered).toHaveLength(0);
});
it('delivery failure preserves an unverified workspace for resend without issuing a session', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('private-provider-error');
  });
  const result = await createWorkspace(db, {
    name: 'Live owner',
    email: 'new-owner@test.com',
    password: 'StrongPassword123!',
    shopName: 'Live shop',
    slug: 'live-shop-recovery',
    category: 'Café',
    location: 'Rabat, Morocco',
  });
  expect(result).toEqual({ verificationRequired: true, verificationDeliveryFailed: true });
  expect(
    (await db.query("SELECT id FROM staff WHERE email='new-owner@test.com'")).rows,
  ).toHaveLength(1);
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM staff_email_tokens WHERE used=false')).rows).toHaveLength(
    0,
  );
});
it('public recovery responses remain account neutral during email delivery outages', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('private-provider-error');
  });
  const service = recovery();
  expect(await service.requestPasswordReset('missing@test.com')).toEqual({ ok: true });
  expect(await service.requestPasswordReset('owner@test.com')).toEqual({ ok: true });
  expect(await service.requestVerification('missing@test.com')).toEqual({ ok: true });
  expect(await service.requestVerification('owner@test.com')).toEqual({ ok: true });
  expect((await db.query('SELECT * FROM staff_email_tokens WHERE used=false')).rows).toHaveLength(
    0,
  );
});
it('initial verification delivery failures remain retryable without leaving a usable link', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('private-provider-error');
  });
  await expect(recovery().sendInitialVerification('owner@test.com')).rejects.toMatchObject({
    status: 503,
  });
  expect((await db.query('SELECT * FROM staff_email_tokens WHERE used=false')).rows).toHaveLength(
    0,
  );
});
it('a live workspace waits for verification before staff access', async () => {
  const result = await createWorkspace(db, {
    name: 'Verified owner',
    email: 'verified-owner@test.com',
    password: 'StrongPassword123!',
    shopName: 'Verified shop',
    slug: 'verified-live-shop',
    category: 'Café',
    location: 'Rabat, Morocco',
  });
  expect(result).toEqual({ verificationRequired: true });
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(0);
  await expect(
    createAuthService(db).signInStaff('verified-owner@test.com', 'StrongPassword123!'),
  ).rejects.toThrow(/verify.*email/i);
  const verified = await recovery().verifyEmail(deliveredToken());
  expect(await createAuthService(db).getStaffActor(verified.token)).toMatchObject({
    role: 'owner',
  });
});
it('an accepted live invitation requires mailbox verification', async () => {
  await db.query("UPDATE staff SET email_verified=true WHERE id='owner'");
  const auth = createAuthService(db);
  const invitation = await auth.inviteStaff(owner, {
    name: 'Cashier',
    email: 'invited@test.com',
    role: 'cashier',
  });
  await auth.acceptStaffInvite(invitation.token, 'NewPassword123!');
  await expect(auth.signInStaff('invited@test.com', 'NewPassword123!')).rejects.toThrow(
    /verify.*email/i,
  );
  const verified = await recovery().verifyEmail(deliveredToken());
  expect(await auth.getStaffActor(verified.token)).toMatchObject({
    shopId: 'shop',
    role: 'cashier',
  });
});
it('exhausted recovery limits preserve a newly committed workspace for verification resend', async () => {
  for (let attempt = 0; attempt < 3; attempt++)
    await recovery().requestVerification('throttled-owner@test.com');
  const result = await createWorkspace(db, {
    name: 'Throttled owner',
    email: 'throttled-owner@test.com',
    password: 'StrongPassword123!',
    shopName: 'Throttled shop',
    slug: 'throttled-live-shop',
    category: 'Café',
    location: 'Rabat, Morocco',
  });
  expect(result).toEqual({ verificationRequired: true, verificationDeliveryFailed: true });
  expect(
    (await db.query("SELECT id FROM staff WHERE email='throttled-owner@test.com'")).rows,
  ).toHaveLength(1);
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(0);
});
it('exhausted recovery limits preserve accepted staff invitations for verification resend', async () => {
  for (let attempt = 0; attempt < 3; attempt++)
    await recovery().requestVerification('throttled-cashier@test.com');
  await db.query("UPDATE staff SET email_verified=true WHERE id='owner'");
  const auth = createAuthService(db);
  const invitation = await auth.inviteStaff(owner, {
    name: 'Throttled cashier',
    email: 'throttled-cashier@test.com',
    role: 'cashier',
  });
  const result = await auth.acceptStaffInvite(invitation.token, 'NewPassword123!');
  expect(result).toEqual({ verificationRequired: true, verificationDeliveryFailed: true });
  expect(
    (await db.query("SELECT id FROM staff WHERE email='throttled-cashier@test.com'")).rows,
  ).toHaveLength(1);
  await expect(auth.acceptStaffInvite(invitation.token, 'NewPassword123!')).rejects.toThrow(
    /invitation/i,
  );
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(0);
});
it('live onboarding rejects a missing, blank, or oversized shop location before creating records', async () => {
  for (const location of [undefined, '   ', 'x'.repeat(201)]) {
    await expect(
      createWorkspace(db, {
        name: 'Location owner',
        email: 'missing-location@test.com',
        password: 'StrongPassword123!',
        shopName: 'Location shop',
        slug: 'missing-location-shop',
        category: 'Café',
        location,
      }),
    ).rejects.toThrow(/location/i);
  }
  expect(
    (await db.query("SELECT id FROM shops WHERE slug='missing-location-shop'")).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("SELECT id FROM staff WHERE email='missing-location@test.com'")).rows,
  ).toHaveLength(0);
  expect(delivered).toHaveLength(0);
});
it('live onboarding saves the supplied shop location after trimming it', async () => {
  await createWorkspace(db, {
    name: 'Location owner',
    email: 'location-owner@test.com',
    password: 'StrongPassword123!',
    shopName: 'Location shop',
    slug: 'real-location-shop',
    category: 'Café',
    location: '  Rabat, Morocco  ',
  });
  expect(
    (
      await db.query<{ location: string }>(
        "SELECT location FROM shops WHERE slug='real-location-shop'",
      )
    ).rows[0].location,
  ).toBe('Rabat, Morocco');
});
it('demo recovery exposes a development link and leaves real email delivery unused', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  const result = await recovery().requestVerification('owner@test.com');
  expect(result.developmentUrl).toContain('https://live.nqta.example/verify-email?token=');
  expect(delivered).toHaveLength(0);
});
it('email recovery shares a three-request window and preserves an opaque persistent bucket', async () => {
  await recovery().requestVerification('owner@test.com');
  await recovery().requestPasswordReset('owner@test.com');
  await recovery().requestVerification('owner@test.com');
  await expect(recovery().requestPasswordReset('owner@test.com')).rejects.toBeInstanceOf(
    RateLimitError,
  );
  const limits = await db.query<{ bucket: string }>('SELECT bucket FROM request_limits');
  expect(limits.rows.every((row) => !row.bucket.includes('owner@test.com'))).toBe(true);
  await db.query(
    "UPDATE request_limits SET window_started=NOW()-interval '16 minutes' WHERE attempts=3",
  );
  expect(await recovery().requestVerification('owner@test.com')).toEqual({ ok: true });
});
it('persistent request limits reserve concurrently and report a bounded retry interval', async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: 7 }, () =>
      reserveLimit(db, {
        scope: 'test-sender',
        key: 'synthetic-ip',
        limit: 3,
        windowSeconds: 900,
      }),
    ),
  );
  expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
  const failures = attempts.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  expect(failures).toHaveLength(4);
  expect(failures[0].reason).toMatchObject({ status: 429 });
  expect(failures[0].reason.retryAfterSeconds).toBeGreaterThan(0);
  expect(failures[0].reason.retryAfterSeconds).toBeLessThanOrEqual(900);
});
it('the global daily recovery budget bounds requests across different addresses', async () => {
  await recovery().requestPasswordReset('unknown-one@test.com');
  await db.query('UPDATE request_limits SET attempts=1000 WHERE attempts=1');
  await expect(recovery().requestPasswordReset('unknown-two@test.com')).rejects.toBeInstanceOf(
    RateLimitError,
  );
  expect(delivered).toHaveLength(0);
});
