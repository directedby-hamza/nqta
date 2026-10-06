import { afterEach, beforeEach, expect, it } from 'vitest';
import { fixture } from './fixture';
import type { Database } from '../../src/server/db/client';
import { createWorkspace } from '../../src/server/auth/onboarding';
let db: Database;
beforeEach(async () => {
  db = await fixture();
});
afterEach(async () => {
  await db.close();
});
it('creates an isolated workspace with an owner session and an unpublished programme', async () => {
  const result = await createWorkspace(db, {
    name: 'Hana',
    email: 'Hana@example.com',
    password: 'StrongPassword123!',
    shopName: 'Hana Studio',
    slug: 'hana-studio',
    category: 'Beauty & wellness',
  });
  expect(result.token).toBeTruthy();
  const shops = await db.query<{ id: string }>("SELECT id FROM shops WHERE slug='hana-studio'");
  const staff = await db.query<{ shop_id: string; role: string }>(
    "SELECT shop_id,role FROM staff WHERE email='hana@example.com'",
  );
  expect(staff.rows[0]).toEqual({ shop_id: shops.rows[0].id, role: 'owner' });
  expect(
    (await db.query('SELECT id FROM programmes WHERE shop_id=$1', [shops.rows[0].id])).rows,
  ).toHaveLength(0);
});
it('rejects a taken shop URL and does not partially create staff or shop records', async () => {
  await expect(
    createWorkspace(db, {
      name: 'Hana',
      email: 'hana@example.com',
      password: 'StrongPassword123!',
      shopName: 'Coffee',
      slug: 'coffee',
      category: 'Café',
    }),
  ).rejects.toThrow(/taken|exists/i);
  expect((await db.query("SELECT id FROM staff WHERE email='hana@example.com'")).rows).toHaveLength(
    0,
  );
});
