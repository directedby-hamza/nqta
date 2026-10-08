import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCustomerService } from '../../src/server/auth/customer';
import {
  createCustomerPasswordService,
  CustomerCredentialError,
} from '../../src/server/auth/customer-password';
import { createLoyaltyService } from '../../src/server/loyalty/service';
import { createReportingService } from '../../src/server/reporting/metrics';
import { createPrivacyService } from '../../src/server/privacy/service';
import { RateLimitError } from '../../src/server/auth/rate-limit';
import type { Database } from '../../src/server/db/client';
import { fixture, owner } from './fixture';

let db: Database;
const password = 'MyCustomerPassword123!';
const replacement = 'MyReplacementPassword456!';
beforeEach(async () => {
  vi.stubEnv('AUTH_MODE', 'recovery-key');
  db = await fixture();
});
afterEach(async () => {
  await db?.close();
  vi.unstubAllEnvs();
});

async function passwords(database = db) {
  return createCustomerPasswordService(database);
}

it('registers a customer without claiming phone ownership and persists only credential hashes', async () => {
  const user = await (await passwords()).register(password);
  expect(user.accountId).toMatch(/^NA-[A-F0-9]{24}$/);
  expect(user.recoveryKey).toMatch(/^[a-f0-9]{64}$/);
  expect(await createCustomerService(db).getCustomerIdentity(user.token)).toBe(user.customerId);
  expect(
    (await db.query('SELECT phone FROM customers WHERE id=$1', [user.customerId])).rows,
  ).toEqual([{ phone: null }]);
  const credentials = (
    await db.query<{ password_hash: string; recovery_key_hash: string }>(
      'SELECT password_hash,recovery_key_hash FROM customer_credentials WHERE customer_id=$1',
      [user.customerId],
    )
  ).rows[0];
  expect(credentials.password_hash).toMatch(/^scrypt:/);
  expect(credentials.password_hash).not.toContain(password);
  expect(credentials.recovery_key_hash).not.toBe(user.recoveryKey);
  expect(credentials.recovery_key_hash).toMatch(/^[a-f0-9]{64}$/);
  expect((await db.query('SELECT * FROM verification_challenges')).rows).toEqual([]);
});

it.each(['short', 'x'.repeat(201)])(
  'rejects passwords outside the policy without creating an account',
  async (invalid) => {
    await expect((await passwords()).register(invalid)).rejects.toThrow(/10.*200/);
    expect((await db.query('SELECT id FROM customers')).rows).toEqual([]);
    expect((await db.query("SELECT id FROM sessions WHERE kind='customer'")).rows).toEqual([]);
  },
);

it('the durable registration budget blocks new service instances and resets after its window', async () => {
  await (await passwords()).register(password);
  await db.query('UPDATE request_limits SET attempts=1000');
  await expect((await passwords()).register(password)).rejects.toBeInstanceOf(RateLimitError);
  expect((await db.query('SELECT id FROM customers')).rows).toHaveLength(1);
  await db.query("UPDATE request_limits SET window_started=NOW()-interval '1 hour'");
  await (await passwords()).register(password);
  expect((await db.query('SELECT id FROM customers')).rows).toHaveLength(2);
});

it('a second password session restores the same earned card and nullable phone reporting', async () => {
  const service = await passwords();
  const first = await service.register(password);
  const customers = createCustomerService(db);
  const member = await customers.joinProgramme(first.customerId, 'programme', 'Mina', {
    sms: false,
    whatsapp: false,
  });
  await createLoyaltyService(db).recordPurchase(owner, {
    membershipId: member.id,
    qualifies: true,
    idempotencyKey: 'key-account-purchase',
  });
  const second = await service.signIn(first.accountId.toLowerCase(), password);
  expect(second.token).not.toBe(first.token);
  expect(second.customerId).toBe(first.customerId);
  const card = await customers.getCard(second.customerId, member.id);
  expect(card.totalStamps).toBe(1);
  expect(card.phone).toBeUndefined();
  expect(card.consents).toEqual({ sms: false, whatsapp: false });
  expect((await createReportingService(db).listMemberships(owner))[0]).toMatchObject({
    id: member.id,
    name: 'Mina',
    phone: '',
    totalStamps: 1,
  });
});

it('wrong passwords and unknown account identifiers return the same generic error without sessions', async () => {
  const service = await passwords();
  const user = await service.register(password);
  await expect(service.signIn(user.accountId, 'WrongPassword123!')).rejects.toThrow(
    'The sign-in credentials are incorrect.',
  );
  await expect(service.signIn('NA-UNKNOWN', password)).rejects.toThrow(
    'The sign-in credentials are incorrect.',
  );
  expect((await db.query("SELECT id FROM sessions WHERE kind='customer'")).rows).toHaveLength(1);
});

it('a public membership code provides no password or recovery authority', async () => {
  const service = await passwords();
  const user = await service.register(password);
  const customers = createCustomerService(db);
  const member = await customers.joinProgramme(user.customerId, 'programme', '', {
    sms: false,
    whatsapp: false,
  });
  const card = await customers.getCard(user.customerId, member.id);
  await expect(service.signIn(card.memberCode, password)).rejects.toThrow(/credentials/i);
  await expect(service.recover(card.memberCode, user.recoveryKey, replacement)).rejects.toThrow(
    /credentials/i,
  );
  await expect(service.recover(user.accountId, card.memberCode, replacement)).rejects.toThrow(
    /credentials/i,
  );
});

it('key recovery changes the password, revokes previous sessions and rejects key replay', async () => {
  const service = await passwords();
  const user = await service.register(password);
  const second = await service.signIn(user.accountId, password);
  const recovered = await service.recover(user.accountId, user.recoveryKey, replacement);
  expect(recovered.customerId).toBe(user.customerId);
  expect(recovered.accountId).toBe(user.accountId);
  expect(recovered.recoveryKey).not.toBe(user.recoveryKey);
  const customers = createCustomerService(db);
  await expect(customers.getCustomerIdentity(user.token)).rejects.toThrow();
  await expect(customers.getCustomerIdentity(second.token)).rejects.toThrow();
  expect(await customers.getCustomerIdentity(recovered.token)).toBe(user.customerId);
  await expect(service.signIn(user.accountId, password)).rejects.toThrow(/credentials/i);
  expect((await service.signIn(user.accountId, replacement)).customerId).toBe(user.customerId);
  await expect(service.recover(user.accountId, user.recoveryKey, password)).rejects.toThrow(
    /credentials/i,
  );
  expect(
    (await service.recover(user.accountId, recovered.recoveryKey, password)).recoveryKey,
  ).not.toBe(recovered.recoveryKey);
});

it('concurrent use of one recovery key permits exactly one successful recovery', async () => {
  const service = await passwords();
  const user = await service.register(password);
  const results = await Promise.allSettled([
    service.recover(user.accountId, user.recoveryKey, replacement),
    service.recover(user.accountId, user.recoveryKey, 'AnotherNewPassword789!'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect((await db.query("SELECT id FROM sessions WHERE kind='customer'")).rows).toHaveLength(1);
  await expect(createCustomerService(db).getCustomerIdentity(user.token)).rejects.toThrow();
});

it('an invalid replacement password leaves the original key and session usable', async () => {
  const service = await passwords();
  const user = await service.register(password);
  await expect(service.recover(user.accountId, user.recoveryKey, 'short')).rejects.toThrow(
    /10.*200/,
  );
  expect(await createCustomerService(db).getCustomerIdentity(user.token)).toBe(user.customerId);
  expect((await service.recover(user.accountId, user.recoveryKey, replacement)).customerId).toBe(
    user.customerId,
  );
});

it('a password sign-in racing recovery cannot leave an old-password session usable', async () => {
  const service = await passwords();
  const user = await service.register(password);
  const [signIn, recovery] = await Promise.allSettled([
    service.signIn(user.accountId, password),
    service.recover(user.accountId, user.recoveryKey, replacement),
  ]);
  expect(recovery.status).toBe('fulfilled');
  if (signIn.status === 'fulfilled')
    await expect(
      createCustomerService(db).getCustomerIdentity(signIn.value.token),
    ).rejects.toThrow();
  expect((await db.query("SELECT id FROM sessions WHERE kind='customer'")).rows).toHaveLength(1);
});

it('the PostgreSQL boundary locks the customer before credentials and every session or credential change', async () => {
  const user = await (await passwords()).register(password);
  const boundary: Database = {
    ...db,
    dialect: 'postgres',
    transaction: (operation) =>
      db.transaction((tx) => {
        let customerLocked = false;
        let credentialsLocked = false;
        return operation({
          ...tx,
          dialect: 'postgres',
          query: async <T>(sql: string, values?: unknown[]) => {
            if (sql.includes('FROM customers') && sql.includes('FOR UPDATE')) {
              expect(values?.[0]).toBe(user.customerId);
              customerLocked = true;
            }
            if (sql.includes('FROM customer_credentials') && sql.includes('FOR UPDATE')) {
              if (!customerLocked) throw new Error('Credentials locked before the customer.');
              credentialsLocked = true;
            }
            if (
              /^(INSERT INTO sessions|UPDATE customer_credentials|DELETE FROM sessions)/.test(
                sql,
              ) &&
              (!customerLocked || !credentialsLocked)
            )
              throw new Error('Authentication changed without holding both account locks.');
            return tx.query<T>(sql, values);
          },
        });
      }),
  };
  const service = await passwords(boundary);
  const signedIn = await service.signIn(user.accountId, password);
  const rotated = await service.rotateRecoveryKey(user.customerId, password);
  const recovered = await service.recover(user.accountId, rotated.recoveryKey, replacement);
  expect(await createCustomerService(db).getCustomerIdentity(recovered.token)).toBe(
    user.customerId,
  );
  await expect(createCustomerService(db).getCustomerIdentity(signedIn.token)).rejects.toThrow();
});

it('rotation requires the current password and makes the previous recovery key unusable', async () => {
  const service = await passwords();
  const user = await service.register(password);
  await expect(service.rotateRecoveryKey(user.customerId, 'WrongPassword123!')).rejects.toThrow(
    /credentials/i,
  );
  const rotated = await service.rotateRecoveryKey(
    user.customerId,
    password,
    ` ${user.accountId.toLowerCase()} `,
  );
  expect(rotated.accountId).toBe(user.accountId);
  expect(rotated.recoveryKey).not.toBe(user.recoveryKey);
  await expect(service.recover(user.accountId, user.recoveryKey, replacement)).rejects.toThrow(
    /credentials/i,
  );
  expect((await service.recover(user.accountId, rotated.recoveryKey, replacement)).customerId).toBe(
    user.customerId,
  );
});

it('key rotation rejects another pending account identifier even when both accounts share a password', async () => {
  const service = await passwords();
  const first = await service.register(password);
  const second = await service.register(password);
  const before = (
    await db.query<{ recovery_key_hash: string }>(
      'SELECT recovery_key_hash FROM customer_credentials WHERE customer_id=$1',
      [second.customerId],
    )
  ).rows;
  await expect(
    service.rotateRecoveryKey(second.customerId, password, first.accountId),
  ).rejects.toBeInstanceOf(CustomerCredentialError);
  expect(
    (
      await db.query('SELECT recovery_key_hash FROM customer_credentials WHERE customer_id=$1', [
        second.customerId,
      ])
    ).rows,
  ).toEqual(before);
  expect(await createCustomerService(db).getCustomerIdentity(second.token)).toBe(second.customerId);
  expect(
    (await service.recover(second.accountId, second.recoveryKey, replacement)).customerId,
  ).toBe(second.customerId);
});

it('durable sign-in limits apply to the account across service instances and do not block another account', async () => {
  const service = await passwords();
  const first = await service.register(password);
  const second = await service.register(password);
  for (let attempt = 0; attempt < 10; attempt++)
    await expect(service.signIn(first.accountId, 'WrongPassword123!')).rejects.toThrow(
      /credentials/i,
    );
  await expect((await passwords()).signIn(first.accountId, password)).rejects.toBeInstanceOf(
    RateLimitError,
  );
  expect((await service.signIn(second.accountId, password)).customerId).toBe(second.customerId);
});

it('durable recovery limits survive failed transactions and service replacement', async () => {
  const service = await passwords();
  const first = await service.register(password);
  const second = await service.register(password);
  for (let attempt = 0; attempt < 5; attempt++)
    await expect(service.recover(first.accountId, 'incorrect-key', replacement)).rejects.toThrow(
      /credentials/i,
    );
  await expect(
    (await passwords()).recover(first.accountId, first.recoveryKey, replacement),
  ).rejects.toBeInstanceOf(RateLimitError);
  expect(
    (await service.recover(second.accountId, second.recoveryKey, replacement)).customerId,
  ).toBe(second.customerId);
});

it('phone-free customers cannot opt into contact channels during enrolment or preference updates', async () => {
  const user = await (await passwords()).register(password);
  const customers = createCustomerService(db);
  await expect(
    customers.joinProgramme(user.customerId, 'programme', 'Mina', { sms: true, whatsapp: false }),
  ).rejects.toThrow(/phone|contact/i);
  expect((await db.query('SELECT id FROM memberships')).rows).toEqual([]);
  const member = await customers.joinProgramme(user.customerId, 'programme', 'Mina', {
    sms: false,
    whatsapp: false,
  });
  await expect(
    customers.updatePreferences(user.customerId, member.id, { sms: false, whatsapp: true }),
  ).rejects.toThrow(/phone|contact/i);
  expect((await customers.getCard(user.customerId, member.id)).consents).toEqual({
    sms: false,
    whatsapp: false,
  });
});

it('last-card deletion removes phone-free credentials and sessions while retaining the loyalty ledger', async () => {
  const service = await passwords();
  const user = await service.register(password);
  const customers = createCustomerService(db);
  const member = await customers.joinProgramme(user.customerId, 'programme', 'Mina', {
    sms: false,
    whatsapp: false,
  });
  await createLoyaltyService(db).recordPurchase(owner, {
    membershipId: member.id,
    qualifies: true,
    idempotencyKey: 'key-account-delete-purchase',
  });
  await customers.requestDeletion(user.customerId, member.id);
  const request = (
    await db.query<{ id: string }>("SELECT id FROM support_requests WHERE kind='deletion'")
  ).rows[0];
  await createPrivacyService(db).fulfilDeletion(
    owner,
    request.id,
    'Customer confirmed account removal.',
  );
  expect((await db.query('SELECT id FROM customers WHERE id=$1', [user.customerId])).rows).toEqual(
    [],
  );
  expect(
    (
      await db.query('SELECT customer_id FROM customer_credentials WHERE customer_id=$1', [
        user.customerId,
      ])
    ).rows,
  ).toEqual([]);
  expect((await db.query('SELECT delta FROM ledger')).rows).toEqual([{ delta: 1 }]);
  await expect(customers.getCustomerIdentity(user.token)).rejects.toThrow();
  await expect(service.signIn(user.accountId, password)).rejects.toThrow(/credentials/i);
  await expect(service.recover(user.accountId, user.recoveryKey, replacement)).rejects.toThrow(
    /credentials/i,
  );
});

it('deleting one merchant card preserves credentials and other merchant cards', async () => {
  const service = await passwords();
  const user = await service.register(password);
  await db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('other-programme','other',5,'Reward','Paid receipt','published')",
  );
  const customers = createCustomerService(db);
  const member = await customers.joinProgramme(user.customerId, 'programme', 'Mina', {
    sms: false,
    whatsapp: false,
  });
  const other = await customers.joinProgramme(user.customerId, 'other-programme', 'Mina', {
    sms: false,
    whatsapp: false,
  });
  await customers.requestDeletion(user.customerId, member.id);
  const request = (
    await db.query<{ id: string }>("SELECT id FROM support_requests WHERE kind='deletion'")
  ).rows[0];
  await createPrivacyService(db).fulfilDeletion(
    owner,
    request.id,
    'Customer confirmed this shop removal.',
  );
  const recovered = await service.signIn(user.accountId, password);
  expect((await customers.getCard(recovered.customerId, other.id)).name).toBe('Mina');
  expect((await db.query('SELECT customer_id FROM customer_credentials')).rows).toHaveLength(1);
});
