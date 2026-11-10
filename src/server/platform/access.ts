import type { Database } from '../db/client';

export type ShopAccess = {
  state: 'unreviewed' | 'pending' | 'active' | 'suspended';
  status: 'unreviewed' | 'pending' | 'active' | 'suspended' | 'expired';
  validUntil: string | null;
  revision: number;
  allowed: boolean;
};
export class ShopAccessError extends Error {
  readonly status = 402;
  constructor(customer = false) {
    super(
      customer
        ? 'This shop is temporarily unavailable. Your existing card is saved.'
        : 'Your workspace subscription is paused or awaiting activation. Please contact Nqta.',
    );
  }
}
export async function getShopAccess(db: Database, shopId: string): Promise<ShopAccess> {
  const row = (
    await db.query<ShopAccess>(
      `
    SELECT COALESCE(b.state,'unreviewed') AS state, b.valid_until::text AS "validUntil",
      COALESCE(b.revision,0) AS revision,
      CASE WHEN b.state='active' AND b.valid_until < (NOW() AT TIME ZONE 'Africa/Casablanca')::date
        THEN 'expired' ELSE COALESCE(b.state,'unreviewed') END AS status,
      COALESCE(b.state,'unreviewed') IN ('active','unreviewed') AND
        (b.valid_until IS NULL OR b.valid_until >= (NOW() AT TIME ZONE 'Africa/Casablanca')::date) AS allowed
    FROM shops s LEFT JOIN shop_billing b ON b.shop_id=s.id WHERE s.id=$1`,
      [shopId],
    )
  ).rows[0];
  if (!row) throw new Error('Shop not found.');
  return row;
}
export async function assertShopAccess(
  db: Database,
  shopId: string,
  customer = false,
): Promise<void> {
  if (!(await getShopAccess(db, shopId)).allowed) throw new ShopAccessError(customer);
}
