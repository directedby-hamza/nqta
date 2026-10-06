import { createDatabase } from '../../src/server/db/client';
import { migrate } from '../../src/server/db/migrate';
import { hashPassword } from '../../src/server/auth/crypto';
export const owner = { userId: 'owner', shopId: 'shop', role: 'owner' as const };
export const cashier = { userId: 'cashier', shopId: 'shop', role: 'cashier' as const };
export const otherOwner = { userId: 'other-owner', shopId: 'other', role: 'owner' as const };
export async function fixture() {
  const db = await createDatabase();
  await migrate(db);
  await db.query(
    "INSERT INTO shops(id,slug,name) VALUES('shop','coffee','Coffee'),('other','other','Other')",
  );
  const password = await hashPassword('CorrectPassword123!');
  for (const staff of [owner, cashier, otherOwner]) {
    await db.query(
      'INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',
      [staff.userId, staff.shopId, staff.userId, `${staff.userId}@test.com`, password, staff.role],
    );
  }
  await db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('programme','shop',5,'One standard coffee','One paid coffee receipt','published')",
  );
  return db;
}
