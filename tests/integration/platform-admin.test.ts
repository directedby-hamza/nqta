import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixture, owner } from './fixture';
import type { Database } from '../../src/server/db/client';
import { createAuthService } from '../../src/server/auth/staff';
import { createPlatformAuth, provisionAdmin } from '../../src/server/platform/auth';
import { createPlatformBilling } from '../../src/server/platform/billing';
import { assertShopAccess, getShopAccess } from '../../src/server/platform/access';
import { assertActor } from '../../src/server/auth/permissions';
import { createCustomerService } from '../../src/server/auth/customer';
import { createWorkspace } from '../../src/server/auth/onboarding';
import { createLoyaltyService } from '../../src/server/loyalty/service';

let db: Database;
let adminId: string;
let auth: ReturnType<typeof createPlatformAuth>;
let billing: ReturnType<typeof createPlatformBilling>;
const temporary = 'TemporaryAdminPassword123!';
const permanent = 'ChangedAdminPassword456!';
beforeEach(async () => {
  db = await fixture();
  auth = createPlatformAuth(db);
  billing = createPlatformBilling(db);
  const admin = await provisionAdmin(db, {
    email: 'admin@nqta.local',
    name: 'Nqta admin',
    password: temporary,
  });
  adminId = admin.id;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db?.close();
});
async function readyAdmin() {
  const first = await auth.signIn('admin@nqta.local', temporary);
  return auth.changePassword(first, temporary, permanent);
}

it('admin identity is separate from merchant credentials and sessions', async () => {
  const staffToken = await createAuthService(db).signInStaff(
    'owner@test.com',
    'CorrectPassword123!',
  );
  await expect(auth.signIn('owner@test.com', 'CorrectPassword123!')).rejects.toThrow(
    /credentials/i,
  );
  await expect(auth.getIdentity(staffToken)).rejects.toThrow(/sign in/i);
  const adminToken = await readyAdmin();
  await expect(createAuthService(db).getStaffActor(adminToken)).rejects.toThrow(/session|sign in/i);
  expect(await auth.getIdentity(adminToken)).toMatchObject({
    id: adminId,
    email: 'admin@nqta.local',
    mustChangePassword: false,
  });
});
it('bootstrap refuses overwrite and temporary credentials cannot administer shops', async () => {
  await expect(
    provisionAdmin(db, { email: ' ADMIN@NQTA.LOCAL ', name: 'Other', password: permanent }),
  ).rejects.toThrow(/exists/i);
  const first = await auth.signIn(' ADMIN@NQTA.LOCAL ', temporary);
  const second = await auth.signIn('admin@nqta.local', temporary);
  expect(await auth.getIdentity(first)).toMatchObject({ mustChangePassword: true });
  await expect(billing.list(adminId)).rejects.toThrow(/password/i);
  await expect(auth.changePassword(first, 'incorrect', permanent)).rejects.toThrow(/password/i);
  const changed = await auth.changePassword(first, temporary, permanent);
  await expect(auth.getIdentity(first)).rejects.toThrow(/sign in/i);
  await expect(auth.getIdentity(second)).rejects.toThrow(/sign in/i);
  expect(await auth.getIdentity(changed)).toMatchObject({ mustChangePassword: false });
});
it('expired and revoked admin sessions cannot access the platform', async () => {
  const current = await readyAdmin();
  await db.query("UPDATE platform_admin_sessions SET expires_at=NOW()-interval '1 minute'");
  await expect(auth.getIdentity(current)).rejects.toThrow(/sign in/i);
  const next = await auth.signIn('admin@nqta.local', permanent);
  await db.query('UPDATE platform_admins SET active=false WHERE id=$1', [adminId]);
  await expect(auth.getIdentity(next)).rejects.toThrow(/sign in/i);
  await expect(billing.list(adminId)).rejects.toThrow(/administrator|sign in/i);
});
it('durable admin login limits reject repeated guessing without creating sessions', async () => {
  for (let i = 0; i < 5; i++)
    await expect(auth.signIn('admin@nqta.local', 'wrong')).rejects.toThrow(/credentials/i);
  await expect(auth.signIn('admin@nqta.local', temporary)).rejects.toThrow(/Too many/i);
  expect((await db.query('SELECT * FROM platform_admin_sessions')).rows).toHaveLength(0);
});
it('existing shops appear unreviewed with no invented payments or customer contact exports', async () => {
  await readyAdmin();
  const result = await billing.list(adminId);
  expect(result.total).toBe(2);
  expect(result.shops.find((s) => s.id === 'shop')).toMatchObject({
    status: 'unreviewed',
    totalPaidMinor: 0,
    ownerEmail: 'owner@test.com',
  });
  expect(result.summary.recordedTotalMinor).toBe(0);
  expect(await getShopAccess(db, 'shop')).toMatchObject({ allowed: true, state: 'unreviewed' });
  expect((await billing.detail(adminId, 'shop')).payments).toHaveLength(0);
  await expect(billing.list('owner')).rejects.toThrow(/administrator|sign in/i);
});
it('suspension blocks stale actors and new enrolment but preserves records and other shops', async () => {
  await readyAdmin();
  await db.query(
    "INSERT INTO customers(id,phone,name) VALUES('customer','+212600999111','Customer')",
  );
  await billing.setAccess(adminId, 'shop', {
    state: 'suspended',
    validUntil: null,
    reason: 'Payment not received',
    expectedRevision: 0,
  });
  await expect(assertActor(db, owner, false, true)).rejects.toThrow(/subscription|paused/i);
  await expect(
    createCustomerService(db).joinProgramme('customer', 'programme', 'Customer', {
      sms: false,
      whatsapp: false,
    }),
  ).rejects.toThrow(/unavailable/i);
  await expect(assertShopAccess(db, 'other')).resolves.toBeUndefined();
  expect((await db.query('SELECT * FROM shops')).rows).toHaveLength(2);
  await expect(
    billing.setAccess(adminId, 'shop', {
      state: 'active',
      validUntil: null,
      reason: 'Stale screen',
      expectedRevision: 0,
    }),
  ).rejects.toThrow(/changed|reload/i);
});
it('recording a payment atomically restores access and retries do not double-count or replay activation', async () => {
  await readyAdmin();
  const input = {
    amountMinor: 19900,
    reference: 'Receipt 001',
    note: 'Bank transfer received',
    validUntil: '2099-12-31',
    requestKey: 'payment-request-001',
  };
  await billing.setAccess(adminId, 'shop', {
    state: 'suspended',
    validUntil: null,
    reason: 'Awaiting payment',
    expectedRevision: 0,
  });
  const [a, b] = await Promise.all([
    billing.recordPayment(adminId, 'shop', input),
    billing.recordPayment(adminId, 'shop', input),
  ]);
  expect(a.id).toBe(b.id);
  expect((await billing.detail(adminId, 'shop')).payments).toHaveLength(1);
  expect((await billing.list(adminId)).summary.recordedTotalMinor).toBe(19900);
  expect(await getShopAccess(db, 'shop')).toMatchObject({
    allowed: true,
    validUntil: '2099-12-31',
  });
  const current = await getShopAccess(db, 'shop');
  await billing.setAccess(adminId, 'shop', {
    state: 'suspended',
    validUntil: null,
    reason: 'Separate review',
    expectedRevision: current.revision,
  });
  await billing.recordPayment(adminId, 'shop', input);
  expect(await getShopAccess(db, 'shop')).toMatchObject({ allowed: false });
  await expect(
    billing.recordPayment(adminId, 'shop', { ...input, amountMinor: 29900 }),
  ).rejects.toThrow(/different|retry/i);
});
it('access expires by Casablanca date and voiding adjusts cash totals without silently changing access', async () => {
  await readyAdmin();
  const payment = await billing.recordPayment(adminId, 'shop', {
    amountMinor: 19900,
    reference: 'Old receipt',
    note: '',
    validUntil: '2020-01-01',
    requestKey: 'old-payment-request',
  });
  expect(await getShopAccess(db, 'shop')).toMatchObject({ allowed: false, status: 'expired' });
  await billing.voidPayment(adminId, 'shop', payment.id, 'Recorded by mistake');
  expect((await billing.list(adminId)).summary.recordedTotalMinor).toBe(0);
  const detail = await billing.detail(adminId, 'shop');
  expect(detail.payments[0]).toMatchObject({ voidReason: 'Recorded by mistake' });
  expect(detail.audit.some((a) => a.action === 'payment.voided')).toBe(true);
  expect(await getShopAccess(db, 'shop')).toMatchObject({ allowed: false, status: 'expired' });
});
it('new production shops require activation while signup still creates a recoverable owner account', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('AUTH_MODE', 'recovery-key');
  const result = await createWorkspace(db, {
    name: 'New owner',
    email: 'new@example.com',
    password: 'NewShopPassword123!',
    shopName: 'New shop',
    slug: 'new-shop',
    category: 'Coffee',
    location: 'Marrakech',
  });
  expect(result.token).toBeTruthy();
  const row = (await db.query<{ id: string }>("SELECT id FROM shops WHERE slug='new-shop'"))
    .rows[0];
  expect(await getShopAccess(db, row.id)).toMatchObject({ state: 'pending', allowed: false });
});

it('blocked direct purchases cannot change balances, while saved cards and privacy requests remain available', async () => {
  await readyAdmin();
  const customers = createCustomerService(db);
  await db.query(
    "INSERT INTO customers(id,phone,name) VALUES('saved-customer','+212600999222','Saved customer')",
  );
  const member = await customers.joinProgramme('saved-customer', 'programme', 'Saved customer', {
    sms: false,
    whatsapp: false,
  });
  const loyalty = createLoyaltyService(db);
  await loyalty.recordPurchase(owner, {
    membershipId: member.id,
    qualifies: true,
    amountMinor: 2500,
    idempotencyKey: 'before-suspension',
  });
  await billing.setAccess(adminId, 'shop', {
    state: 'suspended',
    validUntil: null,
    reason: 'Outstanding subscription',
    expectedRevision: 0,
  });
  await expect(
    loyalty.recordPurchase(owner, {
      membershipId: member.id,
      qualifies: true,
      amountMinor: 2500,
      idempotencyKey: 'after-suspension',
    }),
  ).rejects.toThrow(/subscription|paused/i);
  expect((await customers.getCard('saved-customer', member.id)).totalStamps).toBe(1);
  expect((await db.query("SELECT id FROM events WHERE kind='purchase'")).rows).toHaveLength(1);
  await expect(
    customers.updatePreferences('saved-customer', member.id, { sms: false, whatsapp: false }),
  ).resolves.toBeUndefined();
  await expect(customers.requestDeletion('saved-customer', member.id)).resolves.toBeUndefined();
  expect(
    (await db.query("SELECT id FROM support_requests WHERE kind='deletion'")).rows,
  ).toHaveLength(1);
});

it('rejects invalid payment amounts and dates and never shortens already granted time when recording an older receipt', async () => {
  await readyAdmin();
  const payment = {
    amountMinor: 19900,
    reference: 'Received transfer',
    note: '',
    validUntil: '2099-12-31',
    requestKey: 'validation-payment',
  };
  for (const changes of [
    { amountMinor: 0 },
    { amountMinor: -100 },
    { amountMinor: 1.5 },
    { validUntil: '2026-02-30' },
    { reference: ' ' },
  ]) {
    await expect(
      billing.recordPayment(adminId, 'shop', { ...payment, ...changes }),
    ).rejects.toThrow();
  }
  expect((await billing.detail(adminId, 'shop')).payments).toHaveLength(0);
  await billing.recordPayment(adminId, 'shop', payment);
  await billing.recordPayment(adminId, 'shop', {
    ...payment,
    validUntil: '2026-01-01',
    requestKey: 'older-payment',
  });
  expect(await getShopAccess(db, 'shop')).toMatchObject({
    validUntil: '2099-12-31',
    allowed: true,
  });
});
