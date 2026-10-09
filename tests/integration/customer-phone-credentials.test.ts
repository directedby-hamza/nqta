import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createCustomerPasswordService,
  CustomerCredentialError,
  CustomerLoginUnavailableError,
} from '../../src/server/auth/customer-password';
import { createCustomerService } from '../../src/server/auth/customer';
import { createDatabase, type Database } from '../../src/server/db/client';
import { migrate } from '../../src/server/db/migrate';
import { migrations } from '../../src/server/db/migrate';
import { RateLimitError } from '../../src/server/auth/rate-limit';
import { createLoyaltyService } from '../../src/server/loyalty/service';
import { fixture, owner } from './fixture';

let db: Database;
const password = 'CustomerPhonePassword123!';

beforeEach(async () => {
  vi.stubEnv('AUTH_MODE', 'recovery-key');
  db = await fixture();
});

afterEach(async () => {
  await db?.close();
  vi.unstubAllEnvs();
});

it('registers a normalized sign-in number without a recovery key or verified phone identity', async () => {
  const account = await createCustomerPasswordService(db).register(password, '06 12 34 56 78');
  expect(account).not.toHaveProperty('recoveryKey');
  expect(account).toMatchObject({
    customerId: expect.any(String),
    accountId: expect.any(String),
    token: expect.any(String),
  });
  expect(
    (
      await db.query(
        'SELECT login_phone,recovery_key_hash FROM customer_credentials WHERE customer_id=$1',
        [account.customerId],
      )
    ).rows,
  ).toEqual([{ login_phone: '+212612345678', recovery_key_hash: null }]);
  expect(
    (await db.query('SELECT phone FROM customers WHERE id=$1', [account.customerId])).rows,
  ).toEqual([{ phone: null }]);
  expect((await db.query('SELECT id FROM verification_challenges')).rows).toEqual([]);
  expect(await createCustomerService(db).getCustomerIdentity(account.token)).toBe(
    account.customerId,
  );
});

it('signs into the same account with local, formatted international or legacy account identifiers', async () => {
  const service = createCustomerPasswordService(db);
  const account = await service.register(password, '+212612345678');
  for (const identifier of [
    '0612345678',
    ' +212 (612) 345-678 ',
    account.accountId.toLowerCase(),
  ]) {
    const signedIn = await service.signIn(identifier, password);
    expect(signedIn.customerId).toBe(account.customerId);
    expect(await createCustomerService(db).getCustomerIdentity(signedIn.token)).toBe(
      account.customerId,
    );
  }
});

it('returns the same credential error for malformed or unknown numbers and incorrect passwords', async () => {
  const service = createCustomerPasswordService(db);
  await service.register(password, '+212612345678');
  for (const [identifier, supplied] of [
    ['0612345678', 'WrongPassword123!'],
    ['0712345678', password],
    ['not-a-phone', password],
  ]) {
    await expect(service.signIn(identifier, supplied)).rejects.toBeInstanceOf(
      CustomerCredentialError,
    );
  }
});

it('rejects invalid sign-in numbers without creating credentials or orphan customers', async () => {
  const service = createCustomerPasswordService(db);
  for (const number of [
    '',
    '0512345678',
    '061234567',
    '+0123456789',
    '+212612345678ext1',
    '+212٦١٢٣٤٥٦٧٨',
    'x'.repeat(101),
  ]) {
    await expect(service.register(password, number)).rejects.toThrow(/phone number/i);
  }
  expect((await db.query('SELECT id FROM customers')).rows).toEqual([]);
  expect((await db.query('SELECT customer_id FROM customer_credentials')).rows).toEqual([]);
});

it('concurrent registrations reserve a sign-in number for exactly one account without merging identities', async () => {
  const service = createCustomerPasswordService(db);
  const results = await Promise.allSettled([
    service.register(password, '0612345678'),
    service.register('OtherCustomerPassword456!', '+212612345678'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
    CustomerLoginUnavailableError,
  );
  expect(rejected?.status === 'rejected' && rejected.reason.status).toBe(409);
  expect((await db.query('SELECT id FROM customers')).rows).toHaveLength(1);
  expect((await db.query("SELECT id FROM sessions WHERE kind='customer'")).rows).toHaveLength(1);
});

it('reports only the account sign-in number without exposing an account identifier or key', async () => {
  const service = createCustomerPasswordService(db);
  const phoneAccount = await service.register(password, '0712345678');
  const legacyAccount = await service.register(password);
  expect(await service.getAccount(phoneAccount.customerId)).toEqual({
    loginPhone: '+212712345678',
  });
  expect(await service.getAccount(legacyAccount.customerId)).toEqual({ loginPhone: null });
  await expect(service.getAccount('missing-customer')).rejects.toBeInstanceOf(
    CustomerCredentialError,
  );
});

it('adds a phone login to an authenticated old account only after checking its current password', async () => {
  const service = createCustomerPasswordService(db);
  const legacy = await service.register(password);
  const customers = createCustomerService(db);
  const card = await customers.joinProgramme(legacy.customerId, 'programme', 'Mina', {
    sms: false,
    whatsapp: false,
  });
  await createLoyaltyService(db).recordPurchase(owner, {
    membershipId: card.id,
    qualifies: true,
    idempotencyKey: 'preserve-points-on-login-upgrade',
  });
  const previousCard = await customers.getCard(legacy.customerId, card.id);
  const before = (
    await db.query(
      'SELECT password_hash,recovery_key_hash FROM customer_credentials WHERE customer_id=$1',
      [legacy.customerId],
    )
  ).rows;
  await expect(
    service.setLoginPhone(legacy.customerId, '0612345678', 'WrongPassword123!'),
  ).rejects.toBeInstanceOf(CustomerCredentialError);
  expect(await service.getAccount(legacy.customerId)).toEqual({ loginPhone: null });
  await service.setLoginPhone(legacy.customerId, '0612345678', password);
  expect((await service.signIn('+212612345678', password)).customerId).toBe(legacy.customerId);
  expect((await service.signIn(legacy.accountId, password)).customerId).toBe(legacy.customerId);
  expect(await customers.getCustomerIdentity(legacy.token)).toBe(legacy.customerId);
  expect((await customers.getCard(legacy.customerId, card.id)).memberCode).toBe(
    previousCard.memberCode,
  );
  expect(await customers.getCard(legacy.customerId, card.id)).toMatchObject({
    name: 'Mina',
    progress: 1,
    totalStamps: 1,
  });
  expect(
    (
      await db.query(
        'SELECT password_hash,recovery_key_hash FROM customer_credentials WHERE customer_id=$1',
        [legacy.customerId],
      )
    ).rows,
  ).toEqual(before);
  expect(
    (await db.query('SELECT phone FROM customers WHERE id=$1', [legacy.customerId])).rows,
  ).toEqual([{ phone: null }]);
});

it('does not claim another account when a phone login is already reserved', async () => {
  const service = createCustomerPasswordService(db);
  const first = await service.register(password, '0612345678');
  const second = await service.register(password);
  await expect(
    service.setLoginPhone(second.customerId, '+212612345678', password),
  ).rejects.toBeInstanceOf(CustomerLoginUnavailableError);
  expect(await service.getAccount(second.customerId)).toEqual({ loginPhone: null });
  expect((await service.signIn('0612345678', password)).customerId).toBe(first.customerId);
  expect((await service.signIn(second.accountId, password)).customerId).toBe(second.customerId);
  expect((await db.query('SELECT id FROM customers')).rows).toHaveLength(2);
});

it('a race to upgrade two old accounts assigns a login number to only one customer', async () => {
  const service = createCustomerPasswordService(db);
  const first = await service.register(password);
  const second = await service.register(password);
  const results = await Promise.allSettled([
    service.setLoginPhone(first.customerId, '0612345678', password),
    service.setLoginPhone(second.customerId, '+212612345678', password),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
    CustomerLoginUnavailableError,
  );
  expect(
    (await db.query('SELECT login_phone FROM customer_credentials ORDER BY login_phone NULLS LAST'))
      .rows,
  ).toEqual([{ login_phone: '+212612345678' }, { login_phone: null }]);
  expect(await createCustomerService(db).getCustomerIdentity(first.token)).toBe(first.customerId);
  expect(await createCustomerService(db).getCustomerIdentity(second.token)).toBe(second.customerId);
});

it('rejects recovery on a new account with no key while preserving legacy recovery', async () => {
  const service = createCustomerPasswordService(db);
  const phoneAccount = await service.register(password, '0612345678');
  await expect(
    service.recover(phoneAccount.accountId, '0'.repeat(64), 'ReplacementPassword456!'),
  ).rejects.toBeInstanceOf(CustomerCredentialError);
  expect(await createCustomerService(db).getCustomerIdentity(phoneAccount.token)).toBe(
    phoneAccount.customerId,
  );
  const legacy = await service.register(password);
  expect(
    (await service.recover(legacy.accountId, legacy.recoveryKey, 'ReplacementPassword456!'))
      .customerId,
  ).toBe(legacy.customerId);
});

it('keeps each new signup or password sign-in active for a fixed 90 days', async () => {
  const service = createCustomerPasswordService(db);
  const phoneAccount = await service.register(password, '0612345678');
  const legacy = await service.register(password);
  await service.signIn(phoneAccount.accountId, password);
  await service.signIn(legacy.accountId, password);
  expect(
    (
      await db.query<{ seconds: number }>(
        "SELECT EXTRACT(EPOCH FROM expires_at-created_at)::integer AS seconds FROM sessions WHERE kind='customer'",
      )
    ).rows,
  ).toEqual([
    { seconds: 7776000 },
    { seconds: 7776000 },
    { seconds: 7776000 },
    { seconds: 7776000 },
  ]);
});

it('does not generate a recovery key for a new phone account through the legacy rotation API', async () => {
  const service = createCustomerPasswordService(db);
  const account = await service.register(password, '0612345678');
  await expect(service.rotateRecoveryKey(account.customerId, password)).rejects.toBeInstanceOf(
    CustomerCredentialError,
  );
  expect(
    (
      await db.query('SELECT recovery_key_hash FROM customer_credentials WHERE customer_id=$1', [
        account.customerId,
      ])
    ).rows,
  ).toEqual([{ recovery_key_hash: null }]);
  expect(await createCustomerService(db).getCustomerIdentity(account.token)).toBe(
    account.customerId,
  );
});

it('uses one durable sign-in attempt budget for local and international spellings of the same number', async () => {
  const service = createCustomerPasswordService(db);
  await service.register(password, '0612345678');
  for (let attempt = 0; attempt < 10; attempt++) {
    await expect(
      service.signIn(attempt % 2 ? '+212 (612) 345-678' : '0612345678', 'WrongPassword123!'),
    ).rejects.toBeInstanceOf(CustomerCredentialError);
  }
  await expect(
    createCustomerPasswordService(db).signIn('+212612345678', password),
  ).rejects.toBeInstanceOf(RateLimitError);
});

it('never uses a declared shop contact to claim or merge a different customer account', async () => {
  const service = createCustomerPasswordService(db);
  const legacy = await service.register(password);
  const customers = createCustomerService(db);
  const oldCard = await customers.joinProgramme(
    legacy.customerId,
    'programme',
    'Mina',
    { sms: false, whatsapp: false },
    { phone: '+212612345678', email: 'mina@example.com' },
  );
  const previousCard = await customers.getCard(legacy.customerId, oldCard.id);
  const newcomer = await service.register('DifferentAccountPassword456!', '0612345678');
  expect(newcomer.customerId).not.toBe(legacy.customerId);
  expect(await service.getAccount(legacy.customerId)).toEqual({ loginPhone: null });
  expect((await service.signIn('0612345678', 'DifferentAccountPassword456!')).customerId).toBe(
    newcomer.customerId,
  );
  await expect(customers.getCard(newcomer.customerId, oldCard.id)).rejects.toThrow();
  expect((await customers.getCard(legacy.customerId, oldCard.id)).memberCode).toBe(
    previousCard.memberCode,
  );
});

it('locks an authenticated customer before credentials when adding their sign-in number', async () => {
  const legacy = await createCustomerPasswordService(db).register(password);
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
              expect(values?.[0]).toBe(legacy.customerId);
              customerLocked = true;
            }
            if (sql.includes('FROM customer_credentials') && sql.includes('FOR UPDATE')) {
              if (!customerLocked) throw new Error('Credentials locked before the customer.');
              credentialsLocked = true;
            }
            if (
              sql.startsWith('UPDATE customer_credentials') &&
              (!customerLocked || !credentialsLocked)
            )
              throw new Error('Login changed without both account locks.');
            return tx.query<T>(sql, values);
          },
        });
      }),
  };
  await createCustomerPasswordService(boundary).setLoginPhone(
    legacy.customerId,
    '0612345678',
    password,
  );
  expect((await createCustomerPasswordService(db).signIn('0612345678', password)).customerId).toBe(
    legacy.customerId,
  );
});

it('adds the username migration without assigning contact phones or changing old accounts, cards or applied checksums', async () => {
  await db.close();
  db = await createDatabase();
  await migrate(db, migrations.slice(0, 5));
  await db.query("INSERT INTO shops(id,slug,name) VALUES('shop','shop','Shop')");
  await db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('programme','shop',5,'Coffee','Paid receipt','published')",
  );
  await db.query(
    "INSERT INTO customers(id,phone,name) VALUES('verified','+212612345678','Verified'),('legacy',NULL,'Mina')",
  );
  await db.query(
    "INSERT INTO customer_credentials(customer_id,account_id,password_hash,recovery_key_hash) VALUES('legacy','NA-LEGACY','stored-password-hash','stored-recovery-hash')",
  );
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code,contact_phone,contact_email) VALUES('card','shop','programme','legacy','NQ-PRESERVED','+212712345678','mina@example.com')",
  );
  const previous = (
    await db.query('SELECT version,name,checksum FROM nqta_schema_migrations ORDER BY version')
  ).rows;
  await migrate(db);
  expect(
    (
      await db.query(
        'SELECT customer_id,account_id,password_hash,recovery_key_hash,login_phone FROM customer_credentials',
      )
    ).rows,
  ).toEqual([
    {
      customer_id: 'legacy',
      account_id: 'NA-LEGACY',
      password_hash: 'stored-password-hash',
      recovery_key_hash: 'stored-recovery-hash',
      login_phone: null,
    },
  ]);
  expect((await db.query('SELECT id,phone,name FROM customers ORDER BY id')).rows).toEqual([
    { id: 'legacy', phone: null, name: 'Mina' },
    { id: 'verified', phone: '+212612345678', name: 'Verified' },
  ]);
  expect(
    (
      await db.query(
        'SELECT id,customer_id,member_code,contact_phone,contact_email FROM memberships',
      )
    ).rows,
  ).toEqual([
    {
      id: 'card',
      customer_id: 'legacy',
      member_code: 'NQ-PRESERVED',
      contact_phone: '+212712345678',
      contact_email: 'mina@example.com',
    },
  ]);
  expect(
    (
      await db.query(
        'SELECT version,name,checksum FROM nqta_schema_migrations WHERE version<=5 ORDER BY version',
      )
    ).rows,
  ).toEqual(previous);
});
