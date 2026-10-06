import { afterEach, beforeEach, expect, it } from 'vitest';
import { createProgrammeService } from '../../src/server/loyalty/programme';
import { createLoyaltyService } from '../../src/server/loyalty/service';
import { fixture, owner, cashier } from './fixture';
import type { Database } from '../../src/server/db/client';
let db: Database;
let programme: ReturnType<typeof createProgrammeService>;
beforeEach(async () => {
  db = await fixture();
  programme = createProgrammeService(db);
});
afterEach(async () => {
  await db?.close();
});
it('rejects incomplete programme drafts and cashier configuration', async () => {
  await expect(
    programme.saveProgrammeDraft(owner, {
      threshold: 5,
      rewardDescription: '',
      eligibility: '',
      terms: '',
    }),
  ).rejects.toThrow(/reward|eligibility/i);
  await expect(
    programme.saveProgrammeDraft(cashier, {
      threshold: 5,
      rewardDescription: 'Coffee',
      eligibility: 'Paid coffee',
      terms: 'No expiry',
    }),
  ).rejects.toThrow(/owner/i);
});
it('does not edit the economic rules of a published programme', async () => {
  await expect(
    programme.saveProgrammeDraft(owner, {
      id: 'programme',
      threshold: 10,
      rewardDescription: 'Tea',
      eligibility: 'Tea',
      terms: 'Terms',
    }),
  ).rejects.toThrow(/locked|published/i);
  expect(
    (await db.query<{ threshold: number }>("SELECT threshold FROM programmes WHERE id='programme'"))
      .rows[0].threshold,
  ).toBe(5);
});
it('publishes a complete draft when there is no active programme', async () => {
  await db.query("UPDATE programmes SET status='archived' WHERE id='programme'");
  const draft = await programme.saveProgrammeDraft(owner, {
    threshold: 7,
    rewardDescription: 'One tea',
    eligibility: 'Paid tea receipt',
    terms: 'No expiry',
  });
  await programme.publishProgramme(owner, draft.id, draft.revision);
  expect(
    (await db.query<{ status: string }>('SELECT status FROM programmes WHERE id=$1', [draft.id]))
      .rows[0].status,
  ).toBe('published');
});
it('refuses to publish a draft changed since the owner reviewed it', async () => {
  await db.query("UPDATE programmes SET status='archived' WHERE id='programme'");
  const rules = {
    threshold: 5,
    rewardDescription: 'Coffee',
    eligibility: 'Paid coffee',
    terms: 'No expiry',
  };
  const reviewed = await programme.saveProgrammeDraft(owner, rules);
  const changed = await programme.saveProgrammeDraft(owner, {
    ...rules,
    id: reviewed.id,
    rewardDescription: 'Tea',
  });
  await expect(programme.publishProgramme(owner, reviewed.id, reviewed.revision)).rejects.toThrow(
    /changed|review/i,
  );
  expect(
    (await db.query<{ status: string }>('SELECT status FROM programmes WHERE id=$1', [reviewed.id]))
      .rows[0].status,
  ).toBe('draft');
  await programme.publishProgramme(owner, changed.id, changed.revision);
});
it('pausing a shop blocks new earning without deleting existing records', async () => {
  await db.query("INSERT INTO customers(id,phone,name) VALUES('c','+212600000001','Mina')");
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('m','shop','programme','c','NQ-PAUSE')",
  );
  await programme.pauseShop(owner, true);
  await expect(
    createLoyaltyService(db).recordPurchase(owner, {
      membershipId: 'm',
      idempotencyKey: 'paused',
      qualifies: true,
    }),
  ).rejects.toThrow(/paused/i);
  expect((await db.query('SELECT * FROM memberships')).rows).toHaveLength(1);
});
