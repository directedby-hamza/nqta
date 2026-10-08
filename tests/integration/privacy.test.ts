import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixture, owner, cashier, otherOwner } from './fixture';
import type { Database } from '../../src/server/db/client';
import { createCustomerService } from '../../src/server/auth/customer';
import { createLoyaltyService } from '../../src/server/loyalty/service';
import { createPrivacyService } from '../../src/server/privacy/service';
import { createProgrammeService } from '../../src/server/loyalty/programme';
let db: Database;
let member: { id: string };
beforeEach(async () => {
  db = await fixture();
  await db.query("INSERT INTO customers(id,phone,name) VALUES('person','+212600000099','Mina')");
  member = await createCustomerService(db).joinProgramme('person', 'programme', 'Mina', {
    sms: true,
    whatsapp: false,
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.close();
});
it('deduplicates concurrent deletion requests with exactly one intake audit', async () => {
  const customers = createCustomerService(db);
  await Promise.all([
    customers.requestDeletion('person', member.id),
    customers.requestDeletion('person', member.id),
  ]);
  expect(
    (await db.query("SELECT id FROM support_requests WHERE kind='deletion'")).rows,
  ).toHaveLength(1);
  expect(
    (await db.query("SELECT id FROM audit WHERE action='deletion.requested'")).rows,
  ).toHaveLength(1);
});
it('fulfils shop deletion once, removes its personal identity, closes rewards and preserves ledger', async () => {
  await createLoyaltyService(db).recordPurchase(owner, {
    membershipId: member.id,
    idempotencyKey: 'privacy-purchase',
    qualifies: true,
  });
  await createCustomerService(db).requestDeletion('person', member.id);
  const request = (
    await db.query<{ id: string }>("SELECT id FROM support_requests WHERE kind='deletion'")
  ).rows[0];
  const privacy = createPrivacyService(db);
  await privacy.fulfilDeletion(owner, request.id, 'Customer confirmed removal for this shop.');
  await privacy.fulfilDeletion(owner, request.id, 'Customer confirmed removal for this shop.');
  const row = (
    await db.query<{ status: string; name: string; phone: string }>(
      'SELECT m.status,c.name,c.phone FROM memberships m JOIN customers c ON c.id=m.customer_id WHERE m.id=$1',
      [member.id],
    )
  ).rows[0];
  expect(row.status).toBe('closed');
  expect(row.name).toBe('Removed member');
  expect(row.phone).not.toContain('212600000099');
  expect((await db.query('SELECT id FROM events')).rows).toHaveLength(1);
  expect((await db.query('SELECT id FROM ledger')).rows).toHaveLength(1);
  expect((await db.query("SELECT id FROM customers WHERE id='person'")).rows).toHaveLength(0);
  expect(
    (await db.query('SELECT status FROM support_requests WHERE id=$1', [request.id])).rows[0]
      .status,
  ).toBe('resolved');
  await expect(createCustomerService(db).getCard('person', member.id)).rejects.toThrow(
    /not found|access/i,
  );
});
it('preserves the same customer and loyalty card in another merchant while detaching this one', async () => {
  await db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('other-programme','other',5,'Reward','Paid receipt','published')",
  );
  const other = await createCustomerService(db).joinProgramme('person', 'other-programme', 'Mina', {
    sms: false,
    whatsapp: true,
  });
  for (let receipt = 0; receipt < 5; receipt++)
    await createLoyaltyService(db).recordPurchase(owner, {
      membershipId: member.id,
      idempotencyKey: `deleted-shop-receipt-${receipt}`,
      qualifies: true,
    });
  const reward = (await createCustomerService(db).getCard('person', member.id)).rewards[0];
  const challenge = await createCustomerService(db).createRedemptionChallenge('person', reward.id);
  await createCustomerService(db).requestDeletion('person', member.id);
  const request = (
    await db.query<{ id: string }>("SELECT id FROM support_requests WHERE kind='deletion'")
  ).rows[0];
  await expect(
    createPrivacyService(db).fulfilDeletion(otherOwner, request.id, 'Remove account.'),
  ).rejects.toThrow(/not found|access/i);
  await expect(
    createPrivacyService(db).fulfilDeletion(cashier, request.id, 'Remove account.'),
  ).rejects.toThrow(/owner/i);
  await createPrivacyService(db).fulfilDeletion(owner, request.id, 'Customer confirmed removal.');
  const card = await createCustomerService(db).getCard('person', other.id);
  expect(card.name).toBe('Mina');
  expect(card.consents).toEqual({ sms: false, whatsapp: true });
  expect((await db.query("SELECT phone FROM customers WHERE id='person'")).rows[0].phone).toBe(
    '+212600000099',
  );
  expect(
    (await db.query('SELECT id FROM redemption_challenges WHERE id=$1', [challenge.challengeId]))
      .rows,
  ).toHaveLength(0);
  expect((await db.query('SELECT state FROM rewards WHERE id=$1', [reward.id])).rows[0].state).toBe(
    'revoked',
  );
});
it('requires merchant privacy details before publishing a real programme', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  const programmes = createProgrammeService(db);
  const draft = await programmes.saveProgrammeDraft(otherOwner, {
    threshold: 5,
    rewardDescription: 'Reward',
    eligibility: 'Paid receipt',
    terms: 'Five paid receipts earn one reward.',
  });
  await expect(programmes.publishProgramme(otherOwner, draft.id, draft.revision)).rejects.toThrow(
    /privacy/i,
  );
  await db.query("UPDATE shops SET privacy_notice=$1,privacy_contact=$2 WHERE id='other'", [
    'We use phone and receipt activity to run loyalty. Contact us to remove your card.',
    'privacy@shop.example.org',
  ]);
  await expect(
    programmes.publishProgramme(otherOwner, draft.id, draft.revision),
  ).resolves.toBeUndefined();
});
