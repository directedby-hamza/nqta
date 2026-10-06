import type { Database } from './db/client';
import { id } from './auth/crypto';
export async function auditEvent(
  db: Database,
  shopId: string,
  actorId: string,
  action: string,
  targetId: string,
  reason?: string,
) {
  await db.query(
    'INSERT INTO audit(id,shop_id,actor_id,action,target_id,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [id(), shopId, actorId, action, targetId, reason || null],
  );
}
