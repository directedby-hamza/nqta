import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from '../db/client';
import { hashPassword, hashToken, id, token, verifyPassword } from './crypto';
import { reserveLimit } from './rate-limit';
import { recoveryKeyMode } from '../environment';
import { normaliseCustomerLoginPhone } from '../../lib/customer-phone';

type Credentials = {
  customer_id: string;
  account_id: string;
  login_phone: string | null;
  password_hash: string;
  recovery_key_hash: string | null;
};

export class CustomerCredentialError extends Error {
  constructor() {
    super('The sign-in credentials are incorrect.');
    this.name = 'CustomerCredentialError';
  }
}

export class CustomerLoginUnavailableError extends Error {
  readonly status = 409;
  constructor() {
    super('This sign-in number is unavailable. If you already have an account, sign in.');
    this.name = 'CustomerLoginUnavailableError';
  }
}

const dummyPasswordHash = `scrypt:customer-account-unavailable:${'0'.repeat(128)}`;
const invalidCredentials = () => new CustomerCredentialError();
const normaliseAccount = (value: string) => value.trim().toUpperCase();
type CredentialIdentifier = { column: 'account_id' | 'login_phone'; value: string };

function credentialIdentifier(value: string): CredentialIdentifier | undefined {
  const accountId = normaliseAccount(value);
  if (accountId.startsWith('NA-')) return { column: 'account_id', value: accountId };
  try {
    return { column: 'login_phone', value: normaliseCustomerLoginPhone(value) };
  } catch {
    return undefined;
  }
}

function assertKeyAuthentication() {
  if (!recoveryKeyMode()) throw new Error('Password account authentication is unavailable.');
}

// Lock the customer before credentials, matching identity deletion. Re-read the credentials
// after the lock so concurrent sign-in, recovery and deletion observe the committed state.
async function lockCredentials(db: Database, identifier: CredentialIdentifier) {
  const identity = (
    await db.query<{ customer_id: string }>(
      `SELECT customer_id FROM customer_credentials WHERE ${identifier.column}=$1`,
      [identifier.value],
    )
  ).rows[0];
  if (!identity) return undefined;
  const customer = await db.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [
    identity.customer_id,
  ]);
  if (!customer.rows.length) return undefined;
  return (
    await db.query<Credentials>(
      `SELECT * FROM customer_credentials WHERE ${identifier.column}=$1 AND customer_id=$2 FOR UPDATE`,
      [identifier.value, identity.customer_id],
    )
  ).rows[0];
}

async function createSession(db: Database, customerId: string) {
  const sessionToken = token();
  await db.query(
    "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,$3,'customer',NOW()+interval '90 days')",
    [id(), hashToken(sessionToken), customerId],
  );
  return { token: sessionToken, customerId };
}

export function createCustomerPasswordService(db: Database) {
  type Registration = { token: string; customerId: string; accountId: string };
  function register(password: string): Promise<Registration & { recoveryKey: string }>;
  function register(password: string, phone: string): Promise<Registration>;
  async function register(password: string, phone?: string) {
    assertKeyAuthentication();
    const loginPhone = phone === undefined ? null : normaliseCustomerLoginPhone(phone);
    await reserveLimit(db, {
      scope: 'customer-password-registration',
      key: 'all',
      limit: 1000,
      windowSeconds: 3600,
    });
    const passwordHash = await hashPassword(password);
    const customerId = id();
    const accountId = `NA-${randomBytes(12).toString('hex').toUpperCase()}`;
    const recoveryKey = loginPhone === null ? token() : null;
    return db.transaction(async (tx) => {
      await tx.query('INSERT INTO customers(id) VALUES($1)', [customerId]);
      const inserted = await tx.query(
        'INSERT INTO customer_credentials(customer_id,account_id,password_hash,recovery_key_hash,login_phone) VALUES($1,$2,$3,$4,$5) ON CONFLICT(login_phone) DO NOTHING RETURNING customer_id',
        [
          customerId,
          accountId,
          passwordHash,
          recoveryKey === null ? null : hashToken(recoveryKey),
          loginPhone,
        ],
      );
      if (!inserted.rows.length) throw new CustomerLoginUnavailableError();
      return {
        ...(await createSession(tx, customerId)),
        accountId,
        ...(recoveryKey === null ? {} : { recoveryKey }),
      };
    });
  }
  return {
    register,

    async getAccount(customerId: string): Promise<{ loginPhone: string | null }> {
      assertKeyAuthentication();
      const account = (
        await db.query<{ login_phone: string | null }>(
          'SELECT cc.login_phone FROM customer_credentials cc JOIN customers c ON c.id=cc.customer_id WHERE cc.customer_id=$1',
          [customerId],
        )
      ).rows[0];
      if (!account) throw invalidCredentials();
      return { loginPhone: account.login_phone };
    },

    async setLoginPhone(customerId: string, phone: string, password: string): Promise<void> {
      assertKeyAuthentication();
      const loginPhone = normaliseCustomerLoginPhone(phone);
      await reserveLimit(db, {
        scope: 'customer-login-number-change',
        key: customerId,
        limit: 5,
        windowSeconds: 900,
      });
      try {
        await db.transaction(async (tx) => {
          const customer = await tx.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [
            customerId,
          ]);
          const credentials = customer.rows.length
            ? (
                await tx.query<Credentials>(
                  'SELECT * FROM customer_credentials WHERE customer_id=$1 FOR UPDATE',
                  [customerId],
                )
              ).rows[0]
            : undefined;
          const matches = verifyPassword(password, credentials?.password_hash || dummyPasswordHash);
          if (!credentials || !matches) throw invalidCredentials();
          await tx.query('UPDATE customer_credentials SET login_phone=$1 WHERE customer_id=$2', [
            loginPhone,
            customerId,
          ]);
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === '23505' &&
          'constraint' in error &&
          error.constraint === 'customer_credentials_login_phone'
        )
          throw new CustomerLoginUnavailableError();
        throw error;
      }
    },

    async signIn(account: string, password: string) {
      assertKeyAuthentication();
      const identifier = credentialIdentifier(account);
      await reserveLimit(db, {
        scope: 'customer-password-sign-in',
        key: identifier?.value ?? normaliseAccount(account).slice(0, 100),
        limit: 10,
        windowSeconds: 900,
      });
      return db.transaction(async (tx) => {
        const credentials = identifier ? await lockCredentials(tx, identifier) : undefined;
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
        const credentials = await lockCredentials(tx, { column: 'account_id', value: accountId });
        const suppliedHash = hashToken(key.trim().toLowerCase());
        if (
          !credentials ||
          !credentials.recovery_key_hash ||
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
          !credentials.recovery_key_hash ||
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
