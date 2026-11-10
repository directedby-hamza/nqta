import { z } from 'zod';
import type { Database } from '../db/client';
import { id, hashToken } from '../auth/crypto';
import { requirePlatformAdmin } from './auth';
import { getShopAccess, type ShopAccess } from './access';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const parsed = new Date(`${v}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === v &&
      v >= '2000-01-01' &&
      v <= '2100-12-31'
    );
  }, 'Choose a valid date.');
export const accessInput = z.object({
  state: z.enum(['active', 'pending', 'suspended']),
  validUntil: date.nullable(),
  reason: z.string().trim().min(3).max(500),
  expectedRevision: z.number().int().nonnegative(),
});
export const paymentInput = z.object({
  amountMinor: z.number().int().min(1).max(100000000),
  reference: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500),
  validUntil: date,
  requestKey: z.string().min(8).max(128),
});
export type AccessInput = z.infer<typeof accessInput>;
export type PaymentInput = z.infer<typeof paymentInput>;
export type PlatformShop = {
  id: string;
  name: string;
  slug: string;
  location: string;
  ownerName: string | null;
  ownerEmail: string | null;
  state: ShopAccess['state'];
  status: ShopAccess['status'];
  validUntil: string | null;
  revision: number;
  members: number;
  visits: number;
  totalPaidMinor: number;
  createdAt: string;
};
export type PlatformPayment = {
  id: string;
  amountMinor: number;
  reference: string;
  note: string;
  validUntil: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  recordedBy: string;
};
export type PlatformAudit = {
  id: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  actorName: string;
};
export type ShopDetail = {
  shop: PlatformShop;
  payments: PlatformPayment[];
  audit: PlatformAudit[];
};
export type ShopList = {
  shops: PlatformShop[];
  total: number;
  page: number;
  summary: {
    total: number;
    unreviewed: number;
    pending: number;
    suspended: number;
    expired: number;
    active: number;
    recordedTotalMinor: number;
  };
};
const shopRows = `SELECT s.id,s.name,s.slug,s.location,s.created_at AS "createdAt",
  (SELECT name FROM staff WHERE shop_id=s.id AND role='owner' ORDER BY active DESC,id LIMIT 1) AS "ownerName",
  (SELECT email FROM staff WHERE shop_id=s.id AND role='owner' ORDER BY active DESC,id LIMIT 1) AS "ownerEmail",
  COALESCE(b.state,'unreviewed') AS state, b.valid_until::text AS "validUntil", COALESCE(b.revision,0) AS revision,
  CASE WHEN b.state='active' AND b.valid_until < (NOW() AT TIME ZONE 'Africa/Casablanca')::date THEN 'expired' ELSE COALESCE(b.state,'unreviewed') END AS status,
  (SELECT COUNT(*)::int FROM memberships WHERE shop_id=s.id AND status='active') AS members,
  (SELECT COUNT(*)::int FROM events WHERE shop_id=s.id AND kind='purchase') AS visits,
  (SELECT COALESCE(SUM(amount_minor),0) FROM platform_payments WHERE shop_id=s.id AND voided_at IS NULL) AS "totalPaidMinor"
  FROM shops s LEFT JOIN shop_billing b ON b.shop_id=s.id`;
async function log(
  db: Database,
  adminId: string,
  shopId: string,
  action: string,
  details: Record<string, unknown>,
) {
  await db.query(
    'INSERT INTO platform_audit(id,admin_id,shop_id,action,details) VALUES($1,$2,$3,$4,$5::jsonb)',
    [id(), adminId, shopId, action, JSON.stringify(details)],
  );
}
async function lockShop(db: Database, adminId: string, shopId: string) {
  await requirePlatformAdmin(db, adminId);
  if (!(await db.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [shopId])).rows.length)
    throw new Error('Shop not found.');
  await db.query('INSERT INTO shop_billing(shop_id) VALUES($1) ON CONFLICT(shop_id) DO NOTHING', [
    shopId,
  ]);
}
const safeShop = (row: PlatformShop): PlatformShop => ({
  ...row,
  totalPaidMinor: Number(row.totalPaidMinor),
});
export function createPlatformBilling(db: Database) {
  return {
    async list(
      adminId: string,
      options: { query?: string; status?: string; page?: number } = {},
    ): Promise<ShopList> {
      await requirePlatformAdmin(db, adminId);
      const input = z
        .object({
          query: z.string().max(200).default(''),
          status: z
            .enum(['all', 'unreviewed', 'pending', 'active', 'suspended', 'expired'])
            .default('all'),
          page: z.number().int().min(1).max(100000).default(1),
        })
        .parse(options);
      const search = `%${input.query.trim().replace(/[\\%_]/g, '\\$&')}%`;
      const filter = `WHERE ($1='%%' OR name ILIKE $1 OR slug ILIKE $1 OR "ownerEmail" ILIKE $1) AND ($2='all' OR status=$2)`;
      const rows = await db.query<PlatformShop>(
        `WITH directory AS (${shopRows}) SELECT * FROM directory ${filter} ORDER BY "createdAt" DESC,id LIMIT 25 OFFSET $3`,
        [search, input.status, (input.page - 1) * 25],
      );
      const total = (
        await db.query<{ count: number }>(
          `WITH directory AS (${shopRows}) SELECT COUNT(*)::int AS count FROM directory ${filter}`,
          [search, input.status],
        )
      ).rows[0].count;
      const summary = (
        await db.query<
          ShopList['summary']
        >(`WITH directory AS (${shopRows}) SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status='unreviewed')::int AS unreviewed, COUNT(*) FILTER (WHERE status='pending')::int AS pending,
        COUNT(*) FILTER (WHERE status='suspended')::int AS suspended, COUNT(*) FILTER (WHERE status='expired')::int AS expired,
        COUNT(*) FILTER (WHERE status='active')::int AS active, COALESCE(SUM("totalPaidMinor"),0) AS "recordedTotalMinor" FROM directory`)
      ).rows[0];
      return {
        shops: rows.rows.map(safeShop),
        total,
        page: input.page,
        summary: { ...summary, recordedTotalMinor: Number(summary.recordedTotalMinor) },
      };
    },
    async detail(adminId: string, shopId: string): Promise<ShopDetail> {
      await requirePlatformAdmin(db, adminId);
      const shop = (await db.query<PlatformShop>(`${shopRows} WHERE s.id=$1`, [shopId])).rows[0];
      if (!shop) throw new Error('Shop not found.');
      const payments = (
        await db.query<PlatformPayment>(
          `SELECT p.id,p.amount_minor AS "amountMinor",p.reference,p.note,p.valid_until::text AS "validUntil",
        p.created_at AS "createdAt",p.voided_at AS "voidedAt",p.void_reason AS "voidReason",a.name AS "recordedBy"
        FROM platform_payments p JOIN platform_admins a ON a.id=p.admin_id WHERE p.shop_id=$1 ORDER BY p.created_at DESC,p.id LIMIT 100`,
          [shopId],
        )
      ).rows;
      const audit = (
        await db.query<PlatformAudit>(
          `SELECT l.id,l.action,l.details,l.created_at AS "createdAt",a.name AS "actorName"
        FROM platform_audit l JOIN platform_admins a ON a.id=l.admin_id WHERE l.shop_id=$1 ORDER BY l.created_at DESC,l.id LIMIT 100`,
          [shopId],
        )
      ).rows;
      return { shop: safeShop(shop), payments, audit };
    },
    async setAccess(adminId: string, shopId: string, input: AccessInput) {
      const clean = accessInput.parse(input);
      return db.transaction(async (tx) => {
        await lockShop(tx, adminId, shopId);
        const previous = await getShopAccess(tx, shopId);
        if (previous.revision !== clean.expectedRevision)
          throw new Error('This shop changed in another session. Reload before saving.');
        await tx.query(
          'UPDATE shop_billing SET state=$1,valid_until=$2,revision=revision+1,updated_at=NOW() WHERE shop_id=$3',
          [clean.state, clean.validUntil, shopId],
        );
        await log(tx, adminId, shopId, 'access.changed', {
          before: previous.state,
          beforeValidUntil: previous.validUntil,
          state: clean.state,
          validUntil: clean.validUntil,
          reason: clean.reason,
        });
        return getShopAccess(tx, shopId);
      });
    },
    async recordPayment(adminId: string, shopId: string, input: PaymentInput) {
      const clean = paymentInput.parse(input);
      const fingerprint = hashToken(
        JSON.stringify([clean.amountMinor, clean.reference, clean.note, clean.validUntil]),
      );
      return db.transaction(async (tx) => {
        await lockShop(tx, adminId, shopId);
        const previous = (
          await tx.query<{ id: string; fingerprint: string }>(
            'SELECT id,fingerprint FROM platform_payments WHERE shop_id=$1 AND request_key=$2',
            [shopId, clean.requestKey],
          )
        ).rows[0];
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new Error(
              'This retry contains different payment details. Reload before recording another payment.',
            );
          return { id: previous.id };
        }
        const paymentId = id();
        await tx.query(
          'INSERT INTO platform_payments(id,shop_id,admin_id,amount_minor,reference,note,valid_until,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            paymentId,
            shopId,
            adminId,
            clean.amountMinor,
            clean.reference,
            clean.note,
            clean.validUntil,
            clean.requestKey,
            fingerprint,
          ],
        );
        await tx.query(
          "UPDATE shop_billing SET state='active',valid_until=GREATEST(valid_until,$1::date),revision=revision+1,updated_at=NOW() WHERE shop_id=$2",
          [clean.validUntil, shopId],
        );
        await log(tx, adminId, shopId, 'payment.recorded', {
          paymentId,
          amountMinor: clean.amountMinor,
          reference: clean.reference,
          validUntil: clean.validUntil,
        });
        return { id: paymentId };
      });
    },
    async voidPayment(adminId: string, shopId: string, paymentId: string, reason: string) {
      const clean = z.string().trim().min(3).max(500).parse(reason);
      await db.transaction(async (tx) => {
        await lockShop(tx, adminId, shopId);
        const updated = await tx.query(
          'UPDATE platform_payments SET voided_at=NOW(),voided_by=$1,void_reason=$2 WHERE id=$3 AND shop_id=$4 AND voided_at IS NULL RETURNING id',
          [adminId, clean, paymentId, shopId],
        );
        if (!updated.rows.length) throw new Error('Payment not found or already voided.');
        await log(tx, adminId, shopId, 'payment.voided', {
          paymentId,
          reason: clean,
          accessUnchanged: true,
        });
      });
    },
  };
}
