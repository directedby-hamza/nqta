import type { Database } from './client';
import { createHash } from 'node:crypto';

export type Migration = {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
};

// Applied migrations are immutable. Add a new version for any subsequent schema change.
const statements = [
  `CREATE TABLE IF NOT EXISTS shops (
 id text PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, category text NOT NULL DEFAULT 'Café',
 description text NOT NULL DEFAULT '', location text NOT NULL DEFAULT 'Casablanca', logo_url text NOT NULL DEFAULT '',
 theme text NOT NULL DEFAULT '#175c46', currency text NOT NULL DEFAULT 'MAD', timezone text NOT NULL DEFAULT 'Africa/Casablanca',
 status text NOT NULL DEFAULT 'active', subscription_status text NOT NULL DEFAULT 'Local pilot', created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS staff (
 id text PRIMARY KEY, shop_id text NOT NULL REFERENCES shops(id), name text NOT NULL, email text UNIQUE NOT NULL,
 password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('owner','cashier')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS programmes (
 id text PRIMARY KEY, shop_id text NOT NULL REFERENCES shops(id), version integer NOT NULL DEFAULT 1,
 threshold integer NOT NULL CHECK(threshold BETWEEN 1 AND 100), reward_description text NOT NULL, eligibility text NOT NULL,
 terms text NOT NULL DEFAULT 'One stamp per qualifying paid receipt. Reward-only purchases earn no stamps. No automatic reward expiry.',
 status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_published_programme ON programmes(shop_id) WHERE status='published'`,
  `ALTER TABLE programmes ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1`,
  `CREATE TABLE IF NOT EXISTS customers (id text PRIMARY KEY, phone text UNIQUE NOT NULL, name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS memberships (
 id text PRIMARY KEY, shop_id text NOT NULL REFERENCES shops(id), programme_id text NOT NULL REFERENCES programmes(id),
 customer_id text NOT NULL REFERENCES customers(id), member_code text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT NOW(), UNIQUE(customer_id,programme_id))`,
  `CREATE TABLE IF NOT EXISTS events (
 id text PRIMARY KEY, shop_id text NOT NULL REFERENCES shops(id), membership_id text NOT NULL REFERENCES memberships(id),
 programme_id text NOT NULL REFERENCES programmes(id), staff_id text NOT NULL REFERENCES staff(id),
 kind text NOT NULL CHECK(kind IN ('purchase','redemption','reversal')), qualifies boolean NOT NULL DEFAULT false,
 amount_minor integer CHECK(amount_minor >= 0), receipt_reference text, reversed boolean NOT NULL DEFAULT false,
 original_event_id text REFERENCES events(id), reason text, created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS unique_receipt_reference ON events(shop_id,receipt_reference) WHERE kind='purchase' AND receipt_reference IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS unique_purchase_reversal ON events(original_event_id) WHERE kind='reversal'`,
  `CREATE TABLE IF NOT EXISTS ledger (
 id text PRIMARY KEY, membership_id text NOT NULL REFERENCES memberships(id), event_id text UNIQUE NOT NULL REFERENCES events(id),
 delta integer NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS rewards (
 id text PRIMARY KEY, shop_id text NOT NULL REFERENCES shops(id), membership_id text NOT NULL REFERENCES memberships(id),
 programme_id text NOT NULL REFERENCES programmes(id), sequence integer NOT NULL, description text NOT NULL,
 state text NOT NULL DEFAULT 'available' CHECK(state IN ('available','redeemed','revoked')), created_at timestamptz NOT NULL DEFAULT NOW(),
 redeemed_at timestamptz, redemption_event_id text UNIQUE REFERENCES events(id), UNIQUE(membership_id,sequence))`,
  `CREATE TABLE IF NOT EXISTS redemption_challenges (
 id text PRIMARY KEY, reward_id text NOT NULL REFERENCES rewards(id), customer_id text NOT NULL REFERENCES customers(id),
 code_hash text NOT NULL, expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false, attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS actions (
 shop_id text NOT NULL REFERENCES shops(id), action_key text NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT NOW(), PRIMARY KEY(shop_id,action_key))`,
  `CREATE TABLE IF NOT EXISTS sessions (
 id text PRIMARY KEY, token_hash text UNIQUE NOT NULL, principal_id text NOT NULL, kind text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS verification_challenges (
 id text PRIMARY KEY, phone text NOT NULL, code_hash text NOT NULL, expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0, used boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS staff_invitations (
 id text PRIMARY KEY, shop_id text NOT NULL REFERENCES shops(id), name text NOT NULL, email text NOT NULL,
 role text NOT NULL, token_hash text UNIQUE NOT NULL, used boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL DEFAULT NOW()+interval '48 hours', created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS consents (
 id text PRIMARY KEY, sequence bigserial UNIQUE, membership_id text NOT NULL REFERENCES memberships(id), channel text NOT NULL,
 opted_in boolean NOT NULL, wording_version text NOT NULL DEFAULT '1.0', created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS audit (
 id text PRIMARY KEY, shop_id text REFERENCES shops(id), actor_id text NOT NULL, action text NOT NULL,
 target_id text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS support_requests (
 id text PRIMARY KEY, shop_id text NOT NULL REFERENCES shops(id), membership_id text REFERENCES memberships(id),
 kind text NOT NULL, message text NOT NULL, status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS events_shop_time ON events(shop_id,created_at)`,
  `CREATE INDEX IF NOT EXISTS ledger_membership ON ledger(membership_id)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (id text PRIMARY KEY,email text NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS verification_limits (phone text PRIMARY KEY,window_started timestamptz NOT NULL DEFAULT NOW(),requests integer NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS login_limits (email text PRIMARY KEY,window_started timestamptz NOT NULL DEFAULT NOW(),attempts integer NOT NULL DEFAULT 1)`,
];

export const migrations: readonly Migration[] = [
  { version: 1, name: 'initial_schema', statements },
  {
    version: 2,
    name: 'production_verification_and_privacy',
    statements: [
      `ALTER TABLE staff ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false`,
      `CREATE TABLE IF NOT EXISTS staff_email_tokens (
 id text PRIMARY KEY, staff_id text NOT NULL REFERENCES staff(id), token_hash text UNIQUE NOT NULL,
 kind text NOT NULL CHECK(kind IN ('verify','reset')), used boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS request_limits (
 bucket text PRIMARY KEY, window_started timestamptz NOT NULL DEFAULT NOW(), attempts integer NOT NULL DEFAULT 1)`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS privacy_notice text NOT NULL DEFAULT ''`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS privacy_contact text NOT NULL DEFAULT ''`,
      `ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS resolved_at timestamptz`,
      `ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS resolution text NOT NULL DEFAULT ''`,
    ],
  },
  {
    version: 3,
    name: 'password_accounts_and_recovery_keys',
    statements: [
      `ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL`,
      `CREATE TABLE IF NOT EXISTS customer_credentials (
 customer_id text PRIMARY KEY REFERENCES customers(id), account_id text UNIQUE NOT NULL,
 password_hash text NOT NULL, recovery_key_hash text UNIQUE NOT NULL)`,
      `ALTER TABLE staff ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'verified-contact'
 CHECK(auth_method IN ('verified-contact','recovery-key'))`,
      `ALTER TABLE staff ADD COLUMN IF NOT EXISTS recovery_key_hash text`,
    ],
  },
  {
    version: 4,
    name: 'native_wallet_cards',
    statements: [
      `CREATE TABLE IF NOT EXISTS wallet_passes (
 id text PRIMARY KEY, membership_id text NOT NULL REFERENCES memberships(id),
 provider text NOT NULL CHECK(provider IN ('google','apple')), external_id text NOT NULL,
 revision bigserial UNIQUE NOT NULL, synced_revision bigint NOT NULL DEFAULT 0 CHECK(synced_revision >= 0 AND synced_revision <= revision),
 retry_at timestamptz NOT NULL DEFAULT NOW(), attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
 lock_token text, lease_until timestamptz, locked_revision bigint,
 updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW(),
 UNIQUE(membership_id,provider),
 CHECK((lock_token IS NULL AND lease_until IS NULL AND locked_revision IS NULL) OR
 (lock_token IS NOT NULL AND lease_until IS NOT NULL AND locked_revision IS NOT NULL)))`,
      `CREATE INDEX IF NOT EXISTS wallet_passes_pending ON wallet_passes(retry_at,revision) WHERE revision > synced_revision`,
      `CREATE TABLE IF NOT EXISTS wallet_devices (
 pass_id text NOT NULL REFERENCES wallet_passes(id) ON DELETE CASCADE,
 device_id text NOT NULL, push_token text NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY(pass_id,device_id))`,
      `CREATE INDEX IF NOT EXISTS wallet_devices_identifier ON wallet_devices(device_id,pass_id)`,
    ],
  },
  {
    version: 5,
    name: 'membership_declared_contacts',
    statements: [
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS contact_phone text`,
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS contact_email text`,
    ],
  },
  {
    version: 6,
    name: 'customer_phone_password_accounts',
    statements: [
      `ALTER TABLE customer_credentials ADD COLUMN IF NOT EXISTS login_phone text`,
      `CREATE UNIQUE INDEX IF NOT EXISTS customer_credentials_login_phone ON customer_credentials(login_phone)`,
      `ALTER TABLE customer_credentials ALTER COLUMN recovery_key_hash DROP NOT NULL`,
      `ALTER TABLE customer_credentials ADD CONSTRAINT customer_credentials_login_phone_format
 CHECK(login_phone IS NULL OR login_phone ~ '^[+][1-9][0-9]{7,14}$')`,
    ],
  },
];

function checksum(migration: Migration) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: migration.version,
        name: migration.name,
        statements: migration.statements,
      }),
    )
    .digest('hex');
}
export { checksum as migrationChecksum };

export const migrationHistoryStatement = `CREATE TABLE IF NOT EXISTS nqta_schema_migrations (
 version integer PRIMARY KEY CHECK(version > 0), name text NOT NULL, checksum text NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT NOW())`;

export async function migrate(db: Database, plan: readonly Migration[] = migrations) {
  if (
    plan.some(
      (migration, index) =>
        migration.version !== index + 1 || !migration.name.trim() || !migration.statements.length,
    )
  )
    throw new Error('The migration plan must contain consecutive versions starting at 1.');

  await db.transaction(async (tx) => {
    // All PostgreSQL processes take the same lock before creating even the history table.
    if (db.dialect === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(1852929121, 1)');
    await tx.query(migrationHistoryStatement);
    const { rows } = await tx.query<{ version: number; name: string; checksum: string }>(
      'SELECT version,name,checksum FROM nqta_schema_migrations ORDER BY version',
    );
    for (const [index, applied] of rows.entries()) {
      const expected = plan[applied.version - 1];
      if (!expected)
        throw new Error(
          'The database has a newer or unsupported migration version. Deploy compatible application code.',
        );
      if (applied.version !== index + 1)
        throw new Error(
          'Applied migration history is incomplete. Restore the migration history before startup.',
        );
      if (applied.name !== expected.name || applied.checksum !== checksum(expected))
        throw new Error(
          `Applied migration ${applied.version} has changed. Restore its original definition instead of rewriting history.`,
        );
    }
    for (const migration of plan.slice(rows.length)) {
      for (const statement of migration.statements) await tx.query(statement);
      await tx.query('INSERT INTO nqta_schema_migrations(version,name,checksum) VALUES($1,$2,$3)', [
        migration.version,
        migration.name,
        checksum(migration),
      ]);
    }
  });
}
