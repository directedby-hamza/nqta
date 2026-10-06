import type { Database } from './client';
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
export async function migrate(db: Database) {
  for (const statement of statements) await db.query(statement);
}
