import type { Database } from '../db/client';
import type { Actor } from '../loyalty/types';
export async function assertActor(db: Database, actor: Actor, ownerOnly = false, lockShop = false) {
  // Read authorization after any revocation holding this lock has committed.
  if (lockShop) await db.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [actor.shopId]);
  const { rows } = await db.query<{ role: 'owner' | 'cashier'; name: string }>(
    'SELECT role,name FROM staff WHERE id=$1 AND shop_id=$2 AND active=true',
    [actor.userId, actor.shopId],
  );
  if (!rows[0]) throw new Error('Shop access denied. Please sign in again.');
  if (ownerOnly && rows[0].role !== 'owner')
    throw new Error('This action requires the shop owner.');
  return { ...actor, role: rows[0].role, name: rows[0].name };
}
