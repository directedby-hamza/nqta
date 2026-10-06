import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
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
  phone: text('phone').notNull().unique(),
  name: text('name').notNull().default(''),
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
