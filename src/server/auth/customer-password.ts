import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from '../db/client';
import { hashPassword, hashToken, id, token, verifyPassword } from './crypto';
import { reserveLimit } from './rate-limit';
import { recoveryKeyMode } from '../environment';

type Credentials = {
  customer_id: string;
  account_id: string;
  password_hash: string;
  recovery_key_hash: string;
};

export class CustomerCredentialError extends Error {
  constructor() {
    super('The sign-in credentials are incorrect.');
    this.name = 'CustomerCredentialError';
  }
}

const dummyPasswordHash = `scrypt:customer-account-unavailable:${'0'.repeat(128)}`;
const invalidCredentials = () => new CustomerCredentialError();
const normaliseAccount = (value: string) => value.trim().toUpperCase();

function assertKeyAuthentication() {
  if (!recoveryKeyMode()) throw new Error('Password account authentication is unavailable.');
}

// Lock the customer before credentials, matching identity deletion. Re-read the credentials
// after the lock so concurrent sign-in, recovery and deletion observe the committed state.
async function lockCredentials(db: Database, accountId: string) {
  const identity = (
    await db.query<{ customer_id: string }>(
      'SELECT customer_id FROM customer_credentials WHERE account_id=$1',
      [accountId],
    )
  ).rows[0];
  if (!identity) return undefined;
  const customer = await db.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [
    identity.customer_id,
  ]);
  if (!customer.rows.length) return undefined;
  return (
    await db.query<Credentials>(
      'SELECT * FROM customer_credentials WHERE account_id=$1 AND customer_id=$2 FOR UPDATE',
      [accountId, identity.customer_id],
    )
  ).rows[0];
}

async function createSession(db: Database, customerId: string) {
  const sessionToken = token();
  await db.query(
    "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,$3,'customer',NOW()+interval '30 days')",
    [id(), hashToken(sessionToken), customerId],
  );
  return { token: sessionToken, customerId };
}

export function createCustomerPasswordService(db: Database) {
  return {
    async register(password: string) {
      assertKeyAuthentication();
      await reserveLimit(db, {
        scope: 'customer-password-registration',
        key: 'all',
        limit: 1000,
        windowSeconds: 3600,
      });
      const passwordHash = await hashPassword(password);
      const customerId = id();
      const accountId = `NA-${randomBytes(12).toString('hex').toUpperCase()}`;
      const recoveryKey = token();
      return db.transaction(async (tx) => {
        await tx.query('INSERT INTO customers(id) VALUES($1)', [customerId]);
        await tx.query(
          'INSERT INTO customer_credentials(customer_id,account_id,password_hash,recovery_key_hash) VALUES($1,$2,$3,$4)',
          [customerId, accountId, passwordHash, hashToken(recoveryKey)],
        );
        return { ...(await createSession(tx, customerId)), accountId, recoveryKey };
      });
    },

    async signIn(account: string, password: string) {
      assertKeyAuthentication();
      const accountId = normaliseAccount(account);
      await reserveLimit(db, {
        scope: 'customer-password-sign-in',
        key: accountId,
        limit: 10,
        windowSeconds: 900,
      });
      return db.transaction(async (tx) => {
        const credentials = await lockCredentials(tx, accountId);
        const matches = verifyPassword(password, credentials?.password_hash || dummyPasswordHash);
        if (!credentials || !matches) throw invalidCredentials();
        return createSession(tx, credentials.customer_id);
      });
    },

    async recover(account: string, key: string, password: string) {
      assertKeyAuthentication();
      const accountId = normaliseAccount(account);
      await reserveLimit(db, {
        scope: 'customer-key-recovery',
        key: accountId,
        limit: 5,
        windowSeconds: 900,
      });
      return db.transaction(async (tx) => {
        const credentials = await lockCredentials(tx, accountId);
        const suppliedHash = hashToken(key.trim().toLowerCase());
        if (
          !credentials ||
          !timingSafeEqual(
            Buffer.from(suppliedHash, 'hex'),
            Buffer.from(credentials.recovery_key_hash, 'hex'),
          )
        )
          throw invalidCredentials();
        const passwordHash = await hashPassword(password);
        const recoveryKey = token();
        await tx.query(
          'UPDATE customer_credentials SET password_hash=$1,recovery_key_hash=$2 WHERE customer_id=$3',
          [passwordHash, hashToken(recoveryKey), credentials.customer_id],
        );
        await tx.query("DELETE FROM sessions WHERE kind='customer' AND principal_id=$1", [
          credentials.customer_id,
        ]);
        return { ...(await createSession(tx, credentials.customer_id)), accountId, recoveryKey };
      });
    },

    async rotateRecoveryKey(customerId: string, password: string, expectedAccountId?: string) {
      assertKeyAuthentication();
      await reserveLimit(db, {
        scope: 'customer-key-rotation',
        key: customerId,
        limit: 5,
        windowSeconds: 900,
      });
      return db.transaction(async (tx) => {
        await tx.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [customerId]);
        const credentials = (
          await tx.query<Credentials>(
            'SELECT * FROM customer_credentials WHERE customer_id=$1 FOR UPDATE',
            [customerId],
          )
        ).rows[0];
        const matches = verifyPassword(password, credentials?.password_hash || dummyPasswordHash);
        if (
          !credentials ||
          !matches ||
          (expectedAccountId !== undefined &&
            normaliseAccount(expectedAccountId) !== credentials.account_id)
        )
          throw invalidCredentials();
        const recoveryKey = token();
        await tx.query(
          'UPDATE customer_credentials SET recovery_key_hash=$1 WHERE customer_id=$2',
          [hashToken(recoveryKey), customerId],
        );
        return { accountId: credentials.account_id, recoveryKey };
      });
    },
  };
}
