import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/server/db/client';
import { migrate } from '../../src/server/db/migrate';
import { createLoyaltyService } from '../../src/server/loyalty/service';
import { hashCode } from '../../src/server/auth/crypto';

let db: Database;
let service: ReturnType<typeof createLoyaltyService>;
const owner = { userId: 'owner', shopId: 'shop', role: 'owner' as const };
const cashier = { userId: 'cashier', shopId: 'shop', role: 'cashier' as const };

async function purchase(key: string, overrides = {}) {
  return service.recordPurchase(owner, {
    membershipId: 'member',
    idempotencyKey: key,
    qualifies: true,
    amountMinor: 2500,
    ...overrides,
  });
}
async function unlock() {
  for (let i = 0; i < 5; i++) await purchase(`unlock-${i}`);
}
async function challenge() {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM rewards WHERE state='available' LIMIT 1",
  );
  await db.query(
    "INSERT INTO redemption_challenges(id,reward_id,customer_id,code_hash,expires_at) VALUES($1,$2,'customer',$3,NOW()+interval '2 minutes')",
    ['challenge', rows[0].id, hashCode('challenge', '123456')],
  );
  return { rewardId: rows[0].id, challengeId: 'challenge', code: '123456' };
}

beforeEach(async () => {
  db = await createDatabase();
  await migrate(db);
  await db.query(
    "INSERT INTO shops(id,slug,name) VALUES('shop','coffee','Coffee'),('other','other','Other')",
  );
  await db.query(
    "INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES('owner','shop','Owner','owner@test','unused','owner'),('cashier','shop','Cashier','cashier@test','unused','cashier')",
  );
  await db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('programme','shop',5,'One standard coffee','One paid coffee receipt','published')",
  );
  await db.query("INSERT INTO customers(id,phone,name) VALUES('customer','+212600000000','Mina')");
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('member','shop','programme','customer','NQ-TESTCODE')",
  );
  service = createLoyaltyService(db);
});
afterEach(async () => {
  await db?.close();
});

describe('loyalty transactions against PostgreSQL', () => {
  it('a confirmed invalid amount is explicitly marked as a rejected economic operation', async () => {
    const error = await purchase('invalid-paid-amount', { amountMinor: 0 }).catch((error) => error);
    expect(error).toMatchObject({ operationRejected: true });
    expect((await db.query('SELECT * FROM events')).rows).toHaveLength(0);
  });
  it('a lost commit acknowledgement remains uncertain and retries the already recorded action', async () => {
    const uncertainDb: Database = {
      ...db,
      transaction: async (operation) => {
        await db.transaction(operation);
        throw new Error('Connection terminated unexpectedly');
      },
    };
    const input = { membershipId: 'member', idempotencyKey: 'uncertain-commit', qualifies: true };
    const error = await createLoyaltyService(uncertainDb)
      .recordPurchase(owner, input)
      .catch((error) => error);
    expect(error.operationRejected).not.toBe(true);
    expect((await service.recordPurchase(owner, input)).totalStamps).toBe(1);
    expect((await db.query('SELECT * FROM events')).rows).toHaveLength(1);
  });
  it('five qualifying receipts unlock exactly one reward with zero next-cycle progress', async () => {
    await unlock();
    const state = await service.getMembership(owner, 'member');
    expect(state.progress).toBe(0);
    expect(state.totalStamps).toBe(5);
    expect(state.rewards.filter((r) => r.state === 'available')).toHaveLength(1);
  });
  it('returns the newly issued reward identifier at the threshold and preserves it on retry', async () => {
    for (let i = 0; i < 4; i++) await purchase(`before-issue-${i}`);
    const result = await purchase('issue-result');
    const state = await service.getMembership(owner, 'member');
    expect(result).toHaveProperty('newlyIssuedRewardId', state.rewards[0].id);
    expect(await purchase('issue-result')).toEqual(result);
  });
  it('a free reward-only receipt earns no stamp', async () => {
    await purchase('free-only', { qualifies: false, amountMinor: 0 });
    expect((await service.getMembership(owner, 'member')).totalStamps).toBe(0);
  });
  it('retrying the same receipt five times has one economic effect', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => purchase('retry-once')));
    expect(new Set(results.map((r) => r.eventId)).size).toBe(1);
    expect((await service.getMembership(owner, 'member')).totalStamps).toBe(1);
  });
  it('does not reuse an action key for different input', async () => {
    await purchase('collision');
    await expect(purchase('collision', { amountMinor: 1000 })).rejects.toThrow(/different/i);
  });
  it('rejects another shop membership before revealing details', async () => {
    await expect(service.getMembership({ ...owner, shopId: 'other' }, 'member')).rejects.toThrow(
      /access|shop/i,
    );
  });
  it('allows exactly one of two concurrent redemptions', async () => {
    await unlock();
    const input = await challenge();
    const results = await Promise.allSettled([
      service.redeemReward(owner, { ...input, idempotencyKey: 'redemption-a' }),
      service.redeemReward(cashier, { ...input, idempotencyKey: 'redemption-b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await service.getMembership(owner, 'member')).totalStamps).toBe(5);
  });
  it('redemption retries return the already-confirmed result', async () => {
    await unlock();
    const input = { ...(await challenge()), idempotencyKey: 'redeem-retry' };
    const first = await service.redeemReward(owner, input);
    expect(await service.redeemReward(owner, input)).toEqual(first);
  });
  it('rejects expired and incorrect customer confirmation', async () => {
    await unlock();
    const input = await challenge();
    await expect(
      service.redeemReward(owner, { ...input, code: '999999', idempotencyKey: 'bad-code' }),
    ).rejects.toThrow(/code|confirmation/i);
    await db.query("UPDATE redemption_challenges SET expires_at=NOW()-interval '1 minute'");
    await expect(
      service.redeemReward(owner, { ...input, idempotencyKey: 'expired-code' }),
    ).rejects.toThrow(/expired|confirmation/i);
  });
  it('blocks a correct redemption code after five failed guesses, retaining the failed-attempt count', async () => {
    await unlock();
    const input = await challenge();
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(
        service.redeemReward(owner, {
          ...input,
          code: '999999',
          idempotencyKey: `guess-${attempt}`,
        }),
      ).rejects.toThrow(/code|confirmation/i);
    await expect(
      service.redeemReward(owner, { ...input, idempotencyKey: 'correct-after-guesses' }),
    ).rejects.toThrow(/attempt|new code/i);
    expect(
      (
        await db.query<{ attempts: number }>(
          "SELECT attempts FROM redemption_challenges WHERE id='challenge'",
        )
      ).rows[0].attempts,
    ).toBe(5);
    expect((await service.getMembership(owner, 'member')).rewards[0].state).toBe('available');
  });
  it('reversal removes a stamp and revokes its unredeemed reward only once', async () => {
    await unlock();
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM events WHERE kind='purchase' ORDER BY created_at LIMIT 1",
    );
    const input = { eventId: rows[0].id, reason: 'Full refund', idempotencyKey: 'reverse-one' };
    await service.reversePurchase(owner, input);
    await service.reversePurchase(owner, { ...input, idempotencyKey: 'reverse-second' });
    const state = await service.getMembership(owner, 'member');
    expect(state.totalStamps).toBe(4);
    expect(state.rewards.filter((r) => r.state === 'available')).toHaveLength(0);
  });
  it('refund of an already-redeemed entitlement creates an owner reconciliation flag', async () => {
    await unlock();
    await service.redeemReward(owner, { ...(await challenge()), idempotencyKey: 'used' });
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM events WHERE kind='purchase' ORDER BY created_at LIMIT 1",
    );
    const result = await service.reversePurchase(owner, {
      eventId: rows[0].id,
      reason: 'Refund after reward',
      idempotencyKey: 'refund-used',
    });
    expect(result.needsReview).toBe(true);
    expect(
      (await service.getMembership(owner, 'member')).rewards.filter((r) => r.state === 'redeemed'),
    ).toHaveLength(1);
  });
  it('cashiers cannot reverse a purchase', async () => {
    const result = await purchase('before-refund');
    await expect(
      service.reversePurchase(cashier, {
        eventId: result.eventId,
        reason: 'Refund',
        idempotencyKey: 'denied-refund',
      }),
    ).rejects.toThrow(/owner/i);
  });
  it('rejects a duplicate supplied receipt reference', async () => {
    await purchase('receipt-a', { receiptReference: 'R-101' });
    await expect(purchase('receipt-b', { receiptReference: 'R-101' })).rejects.toThrow(/receipt/i);
  });
});
