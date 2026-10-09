import { afterEach, beforeEach, expect, it } from 'vitest';
import { createCustomerAccessService } from '../../src/server/auth/customer-access';
import type { Database } from '../../src/server/db/client';
import { fixture } from './fixture';

let db: Database;
let access: ReturnType<typeof createCustomerAccessService>;

beforeEach(async () => {
  db = await fixture();
  access = createCustomerAccessService(db);
  await db.query("INSERT INTO customers(id,name) VALUES('mina','Mina'),('sara','Sara')");
  await db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('other-programme','other',5,'Reward','Paid receipt','published')",
  );
});

afterEach(async () => {
  await db?.close();
});

async function membership(
  id: string,
  customerId = 'mina',
  shopId = 'shop',
  programmeId = 'programme',
  createdAt = '2026-10-01T12:00:00Z',
) {
  await db.query(
    'INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [id, shopId, programmeId, customerId, `NQ-${id}`, createdAt],
  );
}

it('returns only the existing card owned by the customer at the requested shop', async () => {
  await membership('mina-coffee');
  await membership('sara-coffee', 'sara');
  await membership('mina-other', 'mina', 'other', 'other-programme');

  expect(await access.lookup('mina', 'coffee')).toEqual({ membershipId: 'mina-coffee' });
  expect(await access.lookup('sara', 'coffee')).toEqual({ membershipId: 'sara-coffee' });
  expect(await access.lookup('mina', 'other')).toEqual({ membershipId: 'mina-other' });
  expect(await access.lookup('sara', 'other')).toEqual({ membershipId: null });
  expect(await access.lookup('unknown-customer', 'coffee')).toEqual({ membershipId: null });
});

it('does not automatically enrol a known customer into a new shop', async () => {
  await membership('mina-coffee');
  const before = (await db.query('SELECT * FROM memberships ORDER BY id')).rows;

  expect(await access.lookup('mina', 'other')).toEqual({ membershipId: null });
  expect((await db.query('SELECT * FROM memberships ORDER BY id')).rows).toEqual(before);
  expect((await db.query('SELECT * FROM consents')).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM audit')).rows).toHaveLength(0);
});

it('recovers an active card even when the shop is paused and its programme is unpublished', async () => {
  await membership('mina-coffee');
  await db.query("UPDATE shops SET status='paused' WHERE id='shop'");
  await db.query("UPDATE programmes SET status='draft' WHERE id='programme'");

  expect(await access.lookup('mina', 'coffee')).toEqual({ membershipId: 'mina-coffee' });
});

it('excludes closed cards instead of returning their identifiers', async () => {
  await membership('mina-coffee');
  await db.query("UPDATE memberships SET status='closed' WHERE id='mina-coffee'");

  expect(await access.lookup('mina', 'coffee')).toEqual({ membershipId: null });
});

it('chooses the latest active card across programme revisions with a deterministic tie break', async () => {
  await db.query("UPDATE programmes SET status='draft' WHERE id='programme'");
  await db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('programme-new','shop',5,'New reward','Paid receipt','published'),('programme-tied','shop',5,'Another reward','Paid receipt','draft'),('programme-closed','shop',5,'Closed reward','Paid receipt','draft')",
  );
  await membership('old-card');
  await membership('a-new-card', 'mina', 'shop', 'programme-new', '2026-10-02T12:00:00Z');
  await membership('z-new-card', 'mina', 'shop', 'programme-tied', '2026-10-02T12:00:00Z');
  await membership('closed-newest', 'mina', 'shop', 'programme-closed', '2026-10-03T12:00:00Z');
  await db.query("UPDATE memberships SET status='closed' WHERE id='closed-newest'");

  expect(await access.lookup('mina', 'coffee')).toEqual({ membershipId: 'z-new-card' });
});

it('requires the exact shop slug and treats unknown or SQL-like slugs as a missing card', async () => {
  await membership('mina-coffee');

  expect(await access.lookup('mina', 'missing-shop')).toEqual({ membershipId: null });
  expect(await access.lookup('mina', "coffee' OR true --")).toEqual({ membershipId: null });
  expect(await access.lookup("mina' OR true --", 'coffee')).toEqual({ membershipId: null });
  expect(await access.lookup('mina', 'Coffee')).toEqual({ membershipId: null });
});
