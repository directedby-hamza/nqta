import { afterEach, beforeEach, expect, it } from 'vitest';
import { createCustomerService } from '../../src/server/auth/customer';
import { createLoyaltyService } from '../../src/server/loyalty/service';
import { fixture, owner } from './fixture';
import type { Database } from '../../src/server/db/client';
let db: Database;
let customer: ReturnType<typeof createCustomerService>;
beforeEach(async () => {
  db = await fixture();
  customer = createCustomerService(db, { development: true });
});
afterEach(async () => {
  await db?.close();
});
async function identity(phone = '+212600000001') {
  const otp = await customer.requestVerification(phone);
  return customer.verifyCode(otp.challengeId, otp.developmentCode!);
}
it('paused shops recover earned cards and allow redemption while refusing new enrolment', async () => {
  const user = await identity();
  const member = await customer.joinProgramme(user.customerId, 'programme', 'Mina', {
    sms: false,
    whatsapp: false,
  });
  const loyalty = createLoyaltyService(db);
  for (let i = 0; i < 5; i++)
    await loyalty.recordPurchase(owner, {
      membershipId: member.id,
      qualifies: true,
      idempotencyKey: `pause-${i}`,
    });
  await db.query("UPDATE shops SET status='paused' WHERE id='shop'");
  const recovered = await identity();
  expect(
    await customer.joinProgramme(recovered.customerId, 'programme', '', {
      sms: false,
      whatsapp: false,
    }),
  ).toEqual(member);
  const card = await customer.getCard(recovered.customerId, member.id);
  expect(card.totalStamps).toBe(5);
  const challenge = await customer.createRedemptionChallenge(
    recovered.customerId,
    card.rewards[0].id,
  );
  await loyalty.redeemReward(owner, {
    rewardId: card.rewards[0].id,
    code: challenge.code,
    idempotencyKey: 'paused-redemption',
  });
  expect((await customer.getCard(recovered.customerId, member.id)).rewards[0].state).toBe(
    'redeemed',
  );
  const fresh = await identity('+212600000002');
  await expect(
    customer.joinProgramme(fresh.customerId, 'programme', '', { sms: false, whatsapp: false }),
  ).rejects.toThrow(/paused/i);
});
it('verification normalises a phone and recovery restores the same identity', async () => {
  const first = await identity('+212 600 000 001');
  const recovered = await identity('+212600000001');
  expect(recovered.customerId).toBe(first.customerId);
});
it('enrolling twice concurrently creates exactly one membership', async () => {
  const user = await identity();
  const cards = await Promise.all([
    customer.joinProgramme(user.customerId, 'programme', 'Mina', { sms: false, whatsapp: false }),
    customer.joinProgramme(user.customerId, 'programme', 'Mina', { sms: false, whatsapp: false }),
  ]);
  expect(cards[0].id).toBe(cards[1].id);
  expect((await db.query('SELECT * FROM memberships')).rows).toHaveLength(1);
});
it('joining without marketing consent preserves loyalty access', async () => {
  const user = await identity();
  const membership = await customer.joinProgramme(user.customerId, 'programme', '', {
    sms: false,
    whatsapp: false,
  });
  expect((await customer.getCard(user.customerId, membership.id)).progress).toBe(0);
  expect(
    (await db.query<{ opted_in: boolean }>('SELECT opted_in FROM consents')).rows.every(
      (r) => !r.opted_in,
    ),
  ).toBe(true);
});
it('customers cannot access another customer card', async () => {
  const first = await identity();
  const second = await identity('+212600000002');
  const membership = await customer.joinProgramme(first.customerId, 'programme', 'Mina', {
    sms: false,
    whatsapp: false,
  });
  await expect(customer.getCard(second.customerId, membership.id)).rejects.toThrow(
    /not found|access/i,
  );
});
it('incorrect codes are rejected and an expired code cannot sign in', async () => {
  const otp = await customer.requestVerification('+212600000001');
  const wrong = otp.developmentCode === '999999' ? '000000' : '999999';
  await expect(customer.verifyCode(otp.challengeId, wrong)).rejects.toThrow(/code/i);
  await db.query("UPDATE verification_challenges SET expires_at=NOW()-interval '1 minute'");
  await expect(customer.verifyCode(otp.challengeId, otp.developmentCode!)).rejects.toThrow(
    /expired|code/i,
  );
});
it('verification attempt limit cannot be bypassed by a correct sixth attempt', async () => {
  const otp = await customer.requestVerification('+212600000001');
  const wrong = otp.developmentCode === '999999' ? '000000' : '999999';
  for (let i = 0; i < 5; i++)
    await expect(customer.verifyCode(otp.challengeId, wrong)).rejects.toThrow();
  await expect(customer.verifyCode(otp.challengeId, otp.developmentCode!)).rejects.toThrow(
    /attempt|code/i,
  );
});
it('a verification code is single-use', async () => {
  const otp = await customer.requestVerification('+212600000001');
  await customer.verifyCode(otp.challengeId, otp.developmentCode!);
  await expect(customer.verifyCode(otp.challengeId, otp.developmentCode!)).rejects.toThrow(
    /used|code/i,
  );
});
it('customer-owned reward creates a two-minute confirmation challenge', async () => {
  const user = await identity();
  const membership = await customer.joinProgramme(user.customerId, 'programme', 'Mina', {
    sms: false,
    whatsapp: false,
  });
  const loyalty = createLoyaltyService(db);
  for (let i = 0; i < 5; i++)
    await loyalty.recordPurchase(owner, {
      membershipId: membership.id,
      idempotencyKey: `p-${i}`,
      qualifies: true,
    });
  const card = await customer.getCard(user.customerId, membership.id);
  const result = await customer.createRedemptionChallenge(user.customerId, card.rewards[0].id);
  expect(result.code).toMatch(/^\d{6}$/);
  expect(new Date(result.expiresAt).getTime() - Date.now()).toBeGreaterThan(110000);
  await db.query("UPDATE redemption_challenges SET expires_at=NOW()-interval '1 minute'");
  await expect(
    loyalty.redeemReward(owner, {
      rewardId: card.rewards[0].id,
      challengeId: result.challengeId,
      code: result.code,
      idempotencyKey: 'expired',
    }),
  ).rejects.toThrow(/expired|confirmation/i);
});
it('production mode never exposes a simulated verification code', async () => {
  const real = createCustomerService(db, { development: false });
  await expect(real.requestVerification('+212600000003')).rejects.toThrow(/provider|configured/i);
});
it('bounds verification delivery requests even when seven arrive simultaneously', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 7 }, () => customer.requestVerification('+212600000009')),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(6);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
});
