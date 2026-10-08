import { randomUUID } from 'node:crypto';
import type { Database } from '../src/server/db/client';
import { token } from '../src/server/auth/crypto';
import { createWorkspace } from '../src/server/auth/onboarding';
import { createAuthService } from '../src/server/auth/staff';
import { createStaffKeyRecoveryService } from '../src/server/auth/staff-key-recovery';
import {
  createCustomerPasswordService,
  CustomerCredentialError,
} from '../src/server/auth/customer-password';
import { createCustomerService } from '../src/server/auth/customer';
import { createProgrammeService } from '../src/server/loyalty/programme';
import { createLoyaltyService } from '../src/server/loyalty/service';

export class DrillKeyError extends Error {
  constructor(readonly code: string) {
    super('Disposable key authentication drill failed.');
    this.name = 'DrillKeyError';
  }
}

/** Synthetic passwords remain in caller memory only. Never serialize or log this state. */
export type KeyAuthDrillState = {
  customer: {
    accountId: string;
    password: string;
    customerId: string;
    membershipId: string;
    totalStamps: number;
  };
  owner: { email: string; password: string; userId: string; shopId: string };
  revokedStaff: { email: string; password: string; userId: string };
};

function sqlState(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return;
  const code = error.code;
  if (typeof code !== 'string') return;
  if (/^[0-9A-Z]{5}$/.test(code)) return code;
  if (/^postgres-[0-9A-Z]{5}$/.test(code)) return code.slice('postgres-'.length);
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new DrillKeyError(code);
}

// Expected credential rejections must never hide deadlocks, timeouts or other SQLSTATEs.
function rejectDatabaseErrors(results: PromiseSettledResult<unknown>[]) {
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    const code = sqlState(result.reason);
    if (code) throw new DrillKeyError(`postgres-${code}`);
  }
}

async function withKeyEnvironment<T>(operation: () => Promise<T>): Promise<T> {
  const saved = {
    AUTH_MODE: process.env.AUTH_MODE,
    NODE_ENV: process.env.NODE_ENV,
    DEMO_MODE: process.env.DEMO_MODE,
    HOSTED_TEST_MODE: process.env.HOSTED_TEST_MODE,
  };
  Object.assign(process.env, {
    AUTH_MODE: 'recovery-key',
    NODE_ENV: 'test',
    DEMO_MODE: 'false',
    HOSTED_TEST_MODE: 'false',
  });
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DrillKeyError) throw error;
    const code = sqlState(error);
    throw new DrillKeyError(code ? `postgres-${code}` : 'key-auth-drill-failed');
  } finally {
    for (const [setting, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[setting];
      else process.env[setting] = value;
    }
  }
}

function credentialFailure(error: unknown) {
  return error instanceof CustomerCredentialError;
}

function staffCredentialFailure(error: unknown) {
  return error instanceof Error && error.message === 'The recovery credentials are incorrect.';
}

function staffSignInFailure(error: unknown) {
  return error instanceof Error && error.message === 'The sign-in credentials are incorrect.';
}

async function count(db: Database, sql: string, values: unknown[]) {
  return Number((await db.query<{ count: string }>(sql, values)).rows[0]?.count);
}

/** Only the caller's already-migrated disposable schemas are used; no schema lifecycle occurs here. */
export async function exerciseKeyAuthConcurrency(
  first: Database,
  second: Database,
): Promise<{ checks: number; state: KeyAuthDrillState }> {
  return withKeyEnvironment(async () => {
    let checks = 0;
    function check(condition: unknown, code: string): asserts condition {
      assert(condition, code);
      checks++;
    }
    async function rejected(
      promise: Promise<unknown>,
      code: string,
      expected?: (error: unknown) => boolean,
    ) {
      const results = await Promise.allSettled([promise]);
      rejectDatabaseErrors(results);
      const result = results[0];
      check(result.status === 'rejected', code);
      if (expected) check(expected(result.reason), `${code}-business-rejection`);
    }

    check(
      first !== second && first.dialect === 'postgres' && second.dialect === 'postgres',
      'two-postgres-connections-required',
    );
    const boundaries = await Promise.allSettled(
      [first, second].map((db) =>
        db.query<{ schema: string; backend_pid: number }>(
          'SELECT current_schema() AS schema,pg_backend_pid() AS backend_pid',
        ),
      ),
    );
    rejectDatabaseErrors(boundaries);
    const scopes = boundaries.map((result) => {
      assert(result.status === 'fulfilled' && result.value.rows[0], 'postgres-boundary-read');
      return result.value.rows[0];
    });
    check(
      /^nqta_check_[a-f0-9]{32}$/.test(scopes[0].schema) && scopes[0].schema === scopes[1].schema,
      'caller-disposable-schema-required',
    );
    check(scopes[0].backend_pid !== scopes[1].backend_pid, 'distinct-postgres-backends-required');

    const suffix = randomUUID().replaceAll('-', '');
    const ownerEmail = `key-owner-${suffix}@example.invalid`;
    const ownerOriginalPassword = token();
    const workspace = await createWorkspace(first, {
      name: 'Synthetic key owner',
      email: ownerEmail,
      password: ownerOriginalPassword,
      shopName: 'Synthetic key merchant',
      slug: `drill-key-${suffix}`,
      category: 'Cafe',
      location: 'Synthetic disposable location',
    });
    const originalOwnerKey = workspace.recoveryKey;
    const originalOwnerSession = workspace.token;
    check(
      originalOwnerKey && originalOwnerSession && !workspace.verificationRequired,
      'provider-free-owner-credentials',
    );
    const auth = [createAuthService(first), createAuthService(second)];
    const owner = await auth[0].getStaffActor(originalOwnerSession);
    const programmes = createProgrammeService(first);
    const programme = await programmes.saveProgrammeDraft(owner, {
      threshold: 5,
      rewardDescription: 'Synthetic reward',
      eligibility: 'Synthetic paid receipt',
      terms: 'Five synthetic paid receipts earn one synthetic reward.',
    });
    await programmes.publishProgramme(owner, programme.id, programme.revision);

    const passwords = [createCustomerPasswordService(first), createCustomerPasswordService(second)];
    const customers = [createCustomerService(first), createCustomerService(second)];
    const customerOriginalPassword = token();
    const customer = await passwords[0].register(customerOriginalPassword);
    const otherCustomer = await passwords[1].register(customerOriginalPassword);
    const membership = await customers[0].joinProgramme(
      customer.customerId,
      programme.id,
      'Synthetic key regular',
      { sms: false, whatsapp: false },
    );
    const loyalty = [createLoyaltyService(first), createLoyaltyService(second)];
    for (let index = 0; index < 3; index++)
      await loyalty[index % 2].recordPurchase(owner, {
        membershipId: membership.id,
        qualifies: true,
        amountMinor: 100,
        idempotencyKey: `key-drill-purchase-${suffix}-${index}`,
        receiptReference: `key-drill-receipt-${suffix}-${index}`,
      });
    const secondCustomerSession = await passwords[1].signIn(
      customer.accountId,
      customerOriginalPassword,
    );
    const otherKeyBefore = (
      await first.query<{ recovery_key_hash: string }>(
        'SELECT recovery_key_hash FROM customer_credentials WHERE customer_id=$1',
        [otherCustomer.customerId],
      )
    ).rows[0]?.recovery_key_hash;
    check(otherKeyBefore, 'other-customer-key-fixture');
    await rejected(
      passwords[1].rotateRecoveryKey(
        otherCustomer.customerId,
        customerOriginalPassword,
        customer.accountId,
      ),
      'customer-cross-account-rotation-rejected',
      credentialFailure,
    );
    check(
      (
        await second.query<{ recovery_key_hash: string }>(
          'SELECT recovery_key_hash FROM customer_credentials WHERE customer_id=$1',
          [otherCustomer.customerId],
        )
      ).rows[0]?.recovery_key_hash === otherKeyBefore,
      'customer-cross-account-key-unchanged',
    );
    check(
      (await customers[0].getCustomerIdentity(otherCustomer.token)) === otherCustomer.customerId,
      'customer-cross-account-session-preserved',
    );
    check(
      (await passwords[1].recover(otherCustomer.accountId, otherCustomer.recoveryKey, token()))
        .customerId === otherCustomer.customerId,
      'customer-cross-account-original-key-usable',
    );

    const customerCandidates = [token(), token()];
    const customerRecoveries = await Promise.allSettled(
      passwords.map((service, index) =>
        service.recover(customer.accountId, customer.recoveryKey, customerCandidates[index]),
      ),
    );
    rejectDatabaseErrors(customerRecoveries);
    const customerWinners = customerRecoveries.flatMap((result, index) =>
      result.status === 'fulfilled' ? [{ index, value: result.value }] : [],
    );
    check(customerWinners.length === 1, 'customer-concurrent-key-single-winner');
    check(
      customerRecoveries.filter(
        (result) => result.status === 'rejected' && credentialFailure(result.reason),
      ).length === 1,
      'customer-concurrent-key-business-loser',
    );
    const customerWinner = customerWinners[0];
    check(
      customerWinner.value.customerId === customer.customerId &&
        customerWinner.value.accountId === customer.accountId &&
        customerWinner.value.recoveryKey !== customer.recoveryKey,
      'customer-recovery-identity-and-key-rotation',
    );
    const oldCustomerSessions = await Promise.allSettled([
      customers[0].getCustomerIdentity(customer.token),
      customers[1].getCustomerIdentity(secondCustomerSession.token),
    ]);
    rejectDatabaseErrors(oldCustomerSessions);
    check(
      oldCustomerSessions.every((result) => result.status === 'rejected'),
      'customer-old-sessions-revoked',
    );
    check(
      (await count(
        first,
        "SELECT COUNT(*) FROM sessions WHERE principal_id=$1 AND kind='customer'",
        [customer.customerId],
      )) === 1,
      'customer-single-replacement-session',
    );
    await rejected(
      passwords[1].recover(customer.accountId, customer.recoveryKey, token()),
      'customer-original-key-replay',
      credentialFailure,
    );
    await rejected(
      passwords[0].signIn(customer.accountId, customerOriginalPassword),
      'customer-old-password-rejected',
      credentialFailure,
    );
    check(
      (await passwords[1].signIn(customer.accountId, customerCandidates[customerWinner.index]))
        .customerId === customer.customerId,
      'customer-winning-password-sign-in',
    );
    const customerFinalPassword = token();
    const finalCustomer = await passwords[1].recover(
      customer.accountId,
      customerWinner.value.recoveryKey,
      customerFinalPassword,
    );
    check(
      finalCustomer.recoveryKey !== customerWinner.value.recoveryKey,
      'customer-replacement-key-accepted-and-rotated',
    );
    await rejected(
      passwords[0].recover(customer.accountId, customerWinner.value.recoveryKey, token()),
      'customer-replacement-key-replay',
      credentialFailure,
    );
    check(
      (await customers[0].getCustomerIdentity(finalCustomer.token)) === customer.customerId,
      'customer-final-session',
    );
    const card = await customers[1].getCard(customer.customerId, membership.id);
    check(
      card.totalStamps === 3 &&
        card.phone === undefined &&
        card.consents?.sms === false &&
        card.consents.whatsapp === false,
      'customer-card-stamps-and-no-contact-preserved',
    );

    const secondOwnerSession = await auth[1].signInStaff(ownerEmail, ownerOriginalPassword);
    const staffRecovery = [
      createStaffKeyRecoveryService(first),
      createStaffKeyRecoveryService(second),
    ];
    const ownerCandidates = [token(), token()];
    const ownerRecoveries = await Promise.allSettled(
      staffRecovery.map((service, index) =>
        service.resetPassword(ownerEmail, originalOwnerKey, ownerCandidates[index]),
      ),
    );
    rejectDatabaseErrors(ownerRecoveries);
    const ownerWinners = ownerRecoveries.flatMap((result, index) =>
      result.status === 'fulfilled' ? [{ index, value: result.value }] : [],
    );
    check(ownerWinners.length === 1, 'owner-concurrent-key-single-winner');
    check(
      ownerRecoveries.filter(
        (result) => result.status === 'rejected' && staffCredentialFailure(result.reason),
      ).length === 1,
      'owner-concurrent-key-business-loser',
    );
    const ownerWinner = ownerWinners[0];
    check(ownerWinner.value.recoveryKey !== originalOwnerKey, 'owner-recovery-key-rotated');
    const oldOwnerSessions = await Promise.allSettled([
      auth[0].getStaffActor(originalOwnerSession),
      auth[1].getStaffActor(secondOwnerSession),
    ]);
    rejectDatabaseErrors(oldOwnerSessions);
    check(
      oldOwnerSessions.every((result) => result.status === 'rejected'),
      'owner-old-sessions-revoked',
    );
    check(
      (await count(first, "SELECT COUNT(*) FROM sessions WHERE principal_id=$1 AND kind='staff'", [
        owner.userId,
      ])) === 0,
      'owner-session-rows-removed',
    );
    await rejected(
      staffRecovery[1].resetPassword(ownerEmail, originalOwnerKey, token()),
      'owner-original-key-replay',
      staffCredentialFailure,
    );
    await rejected(
      auth[0].signInStaff(ownerEmail, ownerOriginalPassword),
      'owner-old-password-rejected',
      staffSignInFailure,
    );
    const intermediateOwnerSession = await auth[1].signInStaff(
      ownerEmail,
      ownerCandidates[ownerWinner.index],
    );
    check(
      (await auth[0].getStaffActor(intermediateOwnerSession)).userId === owner.userId,
      'owner-winning-password-sign-in',
    );
    const ownerFinalPassword = token();
    const finalOwnerKey = await staffRecovery[1].resetPassword(
      ownerEmail,
      ownerWinner.value.recoveryKey,
      ownerFinalPassword,
    );
    check(
      finalOwnerKey.recoveryKey !== ownerWinner.value.recoveryKey,
      'owner-replacement-key-accepted-and-rotated',
    );
    await rejected(
      staffRecovery[0].resetPassword(ownerEmail, ownerWinner.value.recoveryKey, token()),
      'owner-replacement-key-replay',
      staffCredentialFailure,
    );
    await rejected(
      auth[0].getStaffActor(intermediateOwnerSession),
      'owner-intermediate-session-revoked',
    );
    const finalOwner = await auth[0].getStaffActor(
      await auth[1].signInStaff(ownerEmail, ownerFinalPassword),
    );
    check(
      finalOwner.userId === owner.userId && finalOwner.role === 'owner',
      'owner-final-password-sign-in',
    );
    const ownerRow = (
      await first.query<{ auth_method: string; email_verified: boolean }>(
        'SELECT auth_method,email_verified FROM staff WHERE id=$1',
        [owner.userId],
      )
    ).rows[0];
    check(
      ownerRow?.auth_method === 'recovery-key' && ownerRow.email_verified === false,
      'owner-email-remains-unverified',
    );

    const invitedEmail = `key-cashier-${suffix}@example.invalid`;
    const invitedPassword = token();
    const invitation = await auth[0].inviteStaff(finalOwner, {
      name: 'Synthetic key cashier',
      email: invitedEmail,
      role: 'cashier',
    });
    const accepted = await auth[1].acceptStaffInvite(invitation.token, invitedPassword);
    const invitedKey = accepted.recoveryKey;
    check(invitedKey && !accepted.verificationRequired, 'provider-free-invited-key');
    await rejected(
      auth[0].acceptStaffInvite(invitation.token, invitedPassword),
      'invitation-single-use',
      (error) =>
        error instanceof Error &&
        error.message === 'This invitation is expired or has already been used.',
    );
    const invitedSession = await auth[1].signInStaff(invitedEmail, invitedPassword);
    const invited = await auth[0].getStaffActor(invitedSession);
    check(invited.role === 'cashier' && invited.shopId === owner.shopId, 'invited-role-and-shop');
    const invitedRow = (
      await first.query<{ auth_method: string; email_verified: boolean }>(
        'SELECT auth_method,email_verified FROM staff WHERE id=$1',
        [invited.userId],
      )
    ).rows[0];
    check(
      invitedRow?.auth_method === 'recovery-key' && invitedRow.email_verified === false,
      'invited-email-remains-unverified',
    );
    const revocation = await Promise.allSettled([
      auth[1].signInStaff(invitedEmail, invitedPassword),
      auth[0].revokeStaff(finalOwner, invited.userId),
    ]);
    rejectDatabaseErrors(revocation);
    check(revocation[1].status === 'fulfilled', 'invited-concurrent-revocation');
    if (revocation[0].status === 'rejected')
      check(staffSignInFailure(revocation[0].reason), 'invited-revocation-business-rejection');
    else
      await rejected(auth[1].getStaffActor(revocation[0].value), 'invited-racing-session-revoked');
    await rejected(auth[0].getStaffActor(invitedSession), 'invited-original-session-revoked');
    await rejected(
      auth[1].signInStaff(invitedEmail, invitedPassword),
      'invited-revoked-password-denied',
      staffSignInFailure,
    );
    await rejected(
      staffRecovery[1].resetPassword(invitedEmail, invitedKey, token()),
      'invited-revoked-recovery-denied',
      staffCredentialFailure,
    );
    check(
      (await count(first, "SELECT COUNT(*) FROM sessions WHERE principal_id=$1 AND kind='staff'", [
        invited.userId,
      ])) === 0,
      'invited-revoked-session-rows-removed',
    );

    return {
      checks,
      state: {
        customer: {
          accountId: customer.accountId,
          password: customerFinalPassword,
          customerId: customer.customerId,
          membershipId: membership.id,
          totalStamps: 3,
        },
        owner: {
          email: ownerEmail,
          password: ownerFinalPassword,
          userId: owner.userId,
          shopId: owner.shopId,
        },
        revokedStaff: { email: invitedEmail, password: invitedPassword, userId: invited.userId },
      },
    };
  });
}

/** Verify authentication and memberships using the caller's restored disposable snapshot. */
export async function verifyKeyAuthRestore(
  restored: Database,
  state: KeyAuthDrillState,
): Promise<number> {
  return withKeyEnvironment(async () => {
    let checks = 0;
    function check(condition: unknown, code: string): asserts condition {
      assert(condition, code);
      checks++;
    }
    check(restored.dialect === 'postgres', 'postgres-restore-boundary-required');
    const scope = (await restored.query<{ schema: string }>('SELECT current_schema() AS schema'))
      .rows[0]?.schema;
    check(
      scope && /^nqta_check_[a-f0-9]{32}$/.test(scope),
      'caller-disposable-restore-schema-required',
    );
    const signedIn = await createCustomerPasswordService(restored).signIn(
      state.customer.accountId,
      state.customer.password,
    );
    check(
      signedIn.customerId === state.customer.customerId,
      'restored-customer-password-and-identity',
    );
    const customers = createCustomerService(restored);
    check(
      (await customers.getCustomerIdentity(signedIn.token)) === state.customer.customerId,
      'restored-customer-session',
    );
    const card = await customers.getCard(signedIn.customerId, state.customer.membershipId);
    check(
      card.totalStamps === state.customer.totalStamps && card.shopId === state.owner.shopId,
      'restored-customer-card-stamps',
    );
    check(
      card.phone === undefined && card.consents?.sms === false && card.consents.whatsapp === false,
      'restored-customer-no-contact',
    );
    const auth = createAuthService(restored);
    const owner = await auth.getStaffActor(
      await auth.signInStaff(state.owner.email, state.owner.password),
    );
    check(
      owner.userId === state.owner.userId &&
        owner.shopId === state.owner.shopId &&
        owner.role === 'owner',
      'restored-owner-password-and-role',
    );
    const ownerRow = (
      await restored.query<{ auth_method: string; email_verified: boolean }>(
        'SELECT auth_method,email_verified FROM staff WHERE id=$1',
        [state.owner.userId],
      )
    ).rows[0];
    check(
      ownerRow?.auth_method === 'recovery-key' && ownerRow.email_verified === false,
      'restored-owner-unverified-key-method',
    );
    const revoked = await Promise.allSettled([
      auth.signInStaff(state.revokedStaff.email, state.revokedStaff.password),
    ]);
    rejectDatabaseErrors(revoked);
    check(
      revoked[0].status === 'rejected' && staffSignInFailure(revoked[0].reason),
      'restored-revoked-staff-denied',
    );
    const revokedRow = (
      await restored.query<{ active: boolean; auth_method: string; email_verified: boolean }>(
        'SELECT active,auth_method,email_verified FROM staff WHERE id=$1',
        [state.revokedStaff.userId],
      )
    ).rows[0];
    check(
      revokedRow?.active === false &&
        revokedRow.auth_method === 'recovery-key' &&
        revokedRow.email_verified === false,
      'restored-staff-revocation-preserved',
    );
    return checks;
  });
}
