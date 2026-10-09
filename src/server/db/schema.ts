import {
  bigint,
  bigserial,
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
export const shops = pgTable('shops', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  currency: text('currency').notNull().default('MAD'),
  timezone: text('timezone').notNull().default('Africa/Casablanca'),
});
export const programmes = pgTable('programmes', {
  id: text('id').primaryKey(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  threshold: integer('threshold').notNull(),
  revision: integer('revision').notNull().default(1),
  rewardDescription: text('reward_description').notNull(),
  eligibility: text('eligibility').notNull(),
  status: text('status').notNull().default('draft'),
});
export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  phone: text('phone').unique(),
  name: text('name').notNull().default(''),
});
export const customerCredentials = pgTable('customer_credentials', {
  customerId: text('customer_id')
    .primaryKey()
    .references(() => customers.id),
  accountId: text('account_id').notNull().unique(),
  loginPhone: text('login_phone').unique(),
  passwordHash: text('password_hash').notNull(),
  recoveryKeyHash: text('recovery_key_hash').unique(),
});
export const staff = pgTable('staff', {
  id: text('id').primaryKey(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['owner', 'cashier'] }).notNull(),
  active: boolean('active').notNull().default(true),
  emailVerified: boolean('email_verified').notNull().default(false),
  authMethod: text('auth_method', { enum: ['verified-contact', 'recovery-key'] })
    .notNull()
    .default('verified-contact'),
  recoveryKeyHash: text('recovery_key_hash'),
});
export const memberships = pgTable('memberships', {
  id: text('id').primaryKey(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  programmeId: text('programme_id')
    .notNull()
    .references(() => programmes.id),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id),
  memberCode: text('member_code').notNull().unique(),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
export const events = pgTable('events', {
  id: text('id').primaryKey(),
  shopId: text('shop_id').notNull(),
  membershipId: text('membership_id').notNull(),
  kind: text('kind').notNull(),
  amountMinor: integer('amount_minor'),
  qualifies: boolean('qualifies').notNull().default(false),
  reversed: boolean('reversed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
export const walletPasses = pgTable(
  'wallet_passes',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id),
    provider: text('provider', { enum: ['google', 'apple'] }).notNull(),
    externalId: text('external_id').notNull(),
    revision: bigserial('revision', { mode: 'bigint' }).notNull().unique(),
    syncedRevision: bigint('synced_revision', { mode: 'bigint' }).notNull().default(0n),
    retryAt: timestamp('retry_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    lockToken: text('lock_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    lockedRevision: bigint('locked_revision', { mode: 'bigint' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.membershipId, table.provider)],
);
export const walletDevices = pgTable(
  'wallet_devices',
  {
    passId: text('pass_id')
      .notNull()
      .references(() => walletPasses.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    pushToken: text('push_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.passId, table.deviceId] })],
);
