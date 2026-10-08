import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/server/db/client';
import { migrate } from '../../src/server/db/migrate';
import { createLoyaltyService } from '../../src/server/loyalty/service';
import { createPrivacyService } from '../../src/server/privacy/service';
import { createProgrammeService } from '../../src/server/loyalty/programme';
import { hashCode } from '../../src/server/auth/crypto';
import {
  createWalletStore,
  enqueueMembershipWalletUpdates,
  enqueueShopWalletUpdates,
} from '../../src/server/wallet/store';

let db: Database;
const owner = { userId: 'owner', shopId: 'shop', role: 'owner' as const };
const appleType = 'pass.org.nqta.loyalty';
const issue = (member = 'member', provider: 'apple' | 'google' = 'apple', externalId = appleType) =>
  createWalletStore(db).getOrCreatePass('customer', member, provider, externalId);
const purchase = (key: string) =>
  createLoyaltyService(db).recordPurchase(owner, {
    membershipId: 'member',
    idempotencyKey: key,
    qualifies: true,
    amountMinor: 2500,
  });
async function revision(passId: string) {
  return (
    await db.query<{ revision: string }>(
      'SELECT revision::text AS revision FROM wallet_passes WHERE id=$1',
      [passId],
    )
  ).rows[0].revision;
}

beforeEach(async () => {
  db = await createDatabase();
  await migrate(db);
  await db.query(
    "INSERT INTO shops(id,slug,name) VALUES('shop','coffee','Coffee'),('other','other','Other')",
  );
  await db.query(
    "INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES('owner','shop','Owner','owner@test','unused','owner')",
  );
  await db.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('programme','shop',5,'One coffee','Paid receipt','published'),('other-programme','other',5,'Other reward','Paid receipt','published')",
  );
  await db.query(
    "INSERT INTO customers(id,name) VALUES('customer','Mina'),('stranger','Other customer')",
  );
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('member','shop','programme','customer','NQ-WALLET1'),('other-member','other','other-programme','customer','NQ-WALLET2')",
  );
});
afterEach(async () => {
  await db?.close();
});

describe('durable Wallet store', () => {
  it('locks the membership shop before customer identity to serialize issuance with preferences', async () => {
    const guarded: Database = {
      ...db,
      transaction: (operation) =>
        db.transaction(async (tx) => {
          let shopLocked = false;
          return operation({
            ...tx,
            query: async <T>(sql: string, values?: unknown[]) => {
              if (/SELECT id FROM shops.*FOR UPDATE/i.test(sql)) shopLocked = true;
              if (/SELECT id FROM customers.*FOR UPDATE/i.test(sql) && !shopLocked)
                throw new Error('Issuance can deadlock with customer preferences.');
              return tx.query<T>(sql, values);
            },
          });
        }),
    };
    await expect(
      createWalletStore(guarded).getOrCreatePass('customer', 'member', 'apple', appleType),
    ).resolves.toMatchObject({ pass: { membershipId: 'member' } });
  });

  it('locks memberships before the no-pass fast path to serialize first issuance with a mutation', async () => {
    await db.transaction(async (tx) => {
      let memberLocked = false;
      const guarded: Database = {
        ...tx,
        query: async <T>(sql: string, values?: unknown[]) => {
          if (/SELECT id FROM memberships.*FOR UPDATE/i.test(sql)) memberLocked = true;
          if (sql.startsWith('SELECT p.id FROM wallet_passes') && !memberLocked)
            throw new Error('An issuance can race this no-pass check.');
          return tx.query<T>(sql, values);
        },
      };
      await expect(enqueueMembershipWalletUpdates(guarded, 'member')).resolves.toBeUndefined();
    });
    await db.transaction(async (tx) => {
      let membersLocked = false;
      const guarded: Database = {
        ...tx,
        query: async <T>(sql: string, values?: unknown[]) => {
          if (/SELECT id FROM memberships.*FOR UPDATE/i.test(sql)) membersLocked = true;
          if (sql.startsWith('SELECT p.id FROM wallet_passes') && !membersLocked)
            throw new Error('An issuance can race this shop update.');
          return tx.query<T>(sql, values);
        },
      };
      await expect(enqueueShopWalletUpdates(guarded, 'shop')).resolves.toBeUndefined();
    });
  });

  it('checks ownership and active membership before creating or returning a pass', async () => {
    const store = createWalletStore(db);
    await expect(store.getOrCreatePass('stranger', 'member', 'apple', appleType)).rejects.toThrow(
      /access|not found/i,
    );
    expect((await db.query('SELECT id FROM wallet_passes')).rows).toHaveLength(0);
    const first = await issue();
    await db.query("UPDATE memberships SET status='closed' WHERE id='member'");
    await expect(issue()).rejects.toThrow(/inactive|closed/i);
    expect((await store.getPassBySerial('apple', first.pass.id))?.card.status).toBe('closed');
    expect(await store.getPassBySerial('google', first.pass.id)).toBeNull();
  });

  it('returns one stable identity under concurrent issuance and rejects an issuer change', async () => {
    const cards = await Promise.all([issue(), issue(), issue()]);
    expect(new Set(cards.map(({ pass }) => pass.id)).size).toBe(1);
    expect(cards[0].pass).toMatchObject({
      revision: expect.stringMatching(/^\d+$/),
      syncedRevision: '0',
    });
    await expect(issue('member', 'apple', 'pass.org.changed')).rejects.toThrow(
      /configuration|issuer/i,
    );
    expect((await db.query('SELECT id FROM wallet_passes')).rows).toHaveLength(1);
  });

  it('enqueues one revision per economic change, preserving purchase and reversal idempotency', async () => {
    const { pass } = await issue();
    const initial = await revision(pass.id);
    const saved = await purchase('purchase-once');
    const afterPurchase = await revision(pass.id);
    expect(BigInt(afterPurchase)).toBeGreaterThan(BigInt(initial));
    expect(await purchase('purchase-once')).toEqual(saved);
    expect(await revision(pass.id)).toBe(afterPurchase);
    const reversal = {
      eventId: saved.eventId,
      reason: 'Receipt refunded',
      idempotencyKey: 'refund-once',
    };
    const loyalty = createLoyaltyService(db);
    await loyalty.reversePurchase(owner, reversal);
    const afterRefund = await revision(pass.id);
    expect(BigInt(afterRefund)).toBeGreaterThan(BigInt(afterPurchase));
    await loyalty.reversePurchase(owner, { ...reversal, idempotencyKey: 'already-refunded' });
    expect(await revision(pass.id)).toBe(afterRefund);
  });

  it('rolls back the saved economic change and queued revision together', async () => {
    const { pass } = await issue();
    const initial = await revision(pass.id);
    const failing: Database = {
      ...db,
      transaction: (operation) =>
        db.transaction((tx) =>
          operation({
            ...tx,
            query: async <T>(sql: string, values?: unknown[]) => {
              if (sql.startsWith('INSERT INTO actions')) throw new Error('Injected commit failure');
              return tx.query<T>(sql, values);
            },
          }),
        ),
    };
    await expect(
      createLoyaltyService(failing).recordPurchase(owner, {
        membershipId: 'member',
        idempotencyKey: 'rollback',
        qualifies: true,
      }),
    ).rejects.toThrow('Injected commit failure');
    expect(await revision(pass.id)).toBe(initial);
    expect((await db.query('SELECT id FROM events')).rows).toHaveLength(0);
    await expect(
      db.transaction(async (tx) => {
        await enqueueMembershipWalletUpdates(tx, 'member');
        throw new Error('Rollback enqueue');
      }),
    ).rejects.toThrow('Rollback enqueue');
    expect(await revision(pass.id)).toBe(initial);
  });

  it('queues redemption only after a valid customer confirmation and only once', async () => {
    const { pass } = await issue();
    for (let count = 0; count < 5; count++) await purchase(`reward-${count}`);
    const reward = (await db.query<{ id: string }>('SELECT id FROM rewards LIMIT 1')).rows[0];
    await db.query(
      "INSERT INTO redemption_challenges(id,reward_id,customer_id,code_hash,expires_at) VALUES('challenge',$1,'customer',$2,NOW()+interval '2 minutes')",
      [reward.id, hashCode('challenge', '123456')],
    );
    const initial = await revision(pass.id);
    const input = {
      rewardId: reward.id,
      challengeId: 'challenge',
      code: '123456',
      idempotencyKey: 'redeem-once',
    };
    const loyalty = createLoyaltyService(db);
    await expect(
      loyalty.redeemReward(owner, { ...input, code: '999999', idempotencyKey: 'bad-confirmation' }),
    ).rejects.toThrow(/incorrect/i);
    expect(await revision(pass.id)).toBe(initial);
    const result = await loyalty.redeemReward(owner, input);
    const updated = await revision(pass.id);
    expect(BigInt(updated)).toBeGreaterThan(BigInt(initial));
    expect(await loyalty.redeemReward(owner, input)).toEqual(result);
    expect(await revision(pass.id)).toBe(updated);
  });

  it('leases pending work once across concurrent claims and bounds batch limits', async () => {
    const { pass } = await issue();
    const store = createWalletStore(db);
    for (const limit of [0, 21, 1.5])
      await expect(store.claimPendingPasses({ limit })).rejects.toThrow(/limit/i);
    const batches = await Promise.all([
      store.claimPendingPasses({ limit: 20 }),
      store.claimPendingPasses({ limit: 20 }),
    ]);
    const claimed = batches.flat();
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: pass.id, lockToken: expect.any(String) });
    await store.markSynced({ ...claimed[0], lockToken: 'another-worker' });
    expect((await store.getPassBySerial('apple', pass.id))?.pass.syncedRevision).toBe('0');
    await store.markSynced(claimed[0]);
    expect(await store.claimPendingPasses({ passId: pass.id })).toHaveLength(0);
  });

  it('claims only configured providers so disabled provider work cannot starve delivery', async () => {
    const google = await issue('member', 'google', 'issuer.member');
    const apple = await issue();
    const store = createWalletStore(db);
    await expect(store.claimPendingPasses({ providers: ['invalid' as never] })).rejects.toThrow(
      /provider/i,
    );
    expect(await store.claimPendingPasses({ providers: [] })).toHaveLength(0);
    const [claim] = await store.claimPendingPasses({ providers: ['apple'], limit: 1 });
    expect(claim.id).toBe(apple.pass.id);
    await store.markSynced(claim);
    const [remaining] = await store.claimPendingPasses({ providers: ['google'] });
    expect(remaining.id).toBe(google.pass.id);
  });

  it('keeps a newer revision pending when an older leased delivery succeeds', async () => {
    const { pass } = await issue();
    const store = createWalletStore(db);
    const [claimed] = await store.claimPendingPasses({ membershipId: 'member' });
    await purchase('changed-during-delivery');
    const newer = await revision(pass.id);
    await store.markSynced({ ...claimed, revision: newer });
    expect((await store.getPassBySerial('apple', pass.id))?.pass.syncedRevision).toBe('0');
    await store.markSynced(claimed);
    const [next] = await store.claimPendingPasses({ passId: pass.id });
    expect(next.revision).toBe(newer);
    expect(next.syncedRevision).toBe(claimed.revision);
    await store.markSynced(next);
    expect(await store.claimPendingPasses({})).toHaveLength(0);
  });

  it('ignores expired leases and stale workers after another worker reclaims the pass', async () => {
    const { pass } = await issue();
    const store = createWalletStore(db);
    const [oldClaim] = await store.claimPendingPasses({});
    await db.query("UPDATE wallet_passes SET lease_until=NOW()-interval '1 second' WHERE id=$1", [
      pass.id,
    ]);
    await store.markSynced(oldClaim);
    expect((await store.getPassBySerial('apple', pass.id))?.pass.syncedRevision).toBe('0');
    const [newClaim] = await store.claimPendingPasses({});
    expect(newClaim.lockToken).not.toBe(oldClaim.lockToken);
    await store.markFailed(oldClaim);
    await store.markSynced(oldClaim);
    await store.markSynced(newClaim);
    expect(await store.claimPendingPasses({})).toHaveLength(0);
  });

  it('retries failures after backoff and allows a fresh mutation to retry promptly', async () => {
    const { pass } = await issue();
    const store = createWalletStore(db);
    const [claim] = await store.claimPendingPasses({});
    await store.markFailed(claim);
    expect(await store.claimPendingPasses({})).toHaveLength(0);
    expect(
      (await db.query('SELECT attempts FROM wallet_passes WHERE id=$1', [pass.id])).rows[0]
        .attempts,
    ).toBe(1);
    await purchase('retry-new-state');
    expect(await store.claimPendingPasses({})).toHaveLength(1);
  });

  it('closes and queues deleted passes while immediately invalidating the old barcode', async () => {
    const { pass } = await issue();
    const initial = pass.revision;
    await db.query(
      "INSERT INTO support_requests(id,shop_id,membership_id,kind,message) VALUES('delete','shop','member','deletion','Remove my card')",
    );
    await createPrivacyService(db).fulfilDeletion(
      owner,
      'delete',
      'Customer confirmed removal for this shop.',
    );
    const refreshed = await createWalletStore(db).getPassBySerial('apple', pass.id);
    expect(refreshed?.card.status).toBe('closed');
    expect(refreshed?.card.name).not.toContain('Mina');
    expect(refreshed?.card.memberCode).not.toBe('NQ-WALLET1');
    expect(BigInt(refreshed!.pass.revision)).toBeGreaterThan(BigInt(initial));
    await expect(issue()).rejects.toThrow(/access|not found|inactive/i);
    expect(
      (
        await db.query(
          "SELECT id FROM memberships WHERE member_code='NQ-WALLET1' AND status='active'",
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('queues shop pause and branding changes with the shop status on refreshed cards', async () => {
    const first = await issue();
    const other = await issue('other-member');
    await createProgrammeService(db).pauseShop(owner, true);
    const paused = await createWalletStore(db).getPassBySerial('apple', first.pass.id);
    expect(paused?.card.shopStatus).toBe('paused');
    expect(BigInt(paused!.pass.revision)).toBeGreaterThan(BigInt(first.pass.revision));
    expect(await revision(other.pass.id)).toBe(other.pass.revision);
    await db.transaction(async (tx) => {
      await tx.query("UPDATE shops SET name='New coffee name' WHERE id='shop'");
      await enqueueShopWalletUpdates(tx, 'shop');
    });
    expect(
      (await createWalletStore(db).getPassBySerial('apple', first.pass.id))?.card.shopName,
    ).toBe('New coffee name');
  });

  it('scopes Apple registration and token removal to the correct pass and device', async () => {
    const apple = await issue();
    const google = await issue('member', 'google', 'issuer.member');
    const store = createWalletStore(db);
    await expect(store.registerAppleDevice(google.pass.id, 'device', 'aa')).rejects.toThrow(
      /apple|pass/i,
    );
    await expect(store.registerAppleDevice('missing', 'device', 'aa')).rejects.toThrow(
      /pass|not found/i,
    );
    expect(await store.registerAppleDevice(apple.pass.id, 'device', 'aa')).toEqual({
      created: true,
    });
    expect(await store.registerAppleDevice(apple.pass.id, 'device', 'bb')).toEqual({
      created: false,
    });
    expect(await store.getAppleDevices(apple.pass.id)).toEqual([
      { deviceId: 'device', pushToken: 'bb' },
    ]);
    await store.removeAppleDevice(apple.pass.id, 'device', 'aa');
    expect(await store.getAppleDevices(apple.pass.id)).toHaveLength(1);
    await store.removeAppleDevice(apple.pass.id, 'device', 'bb');
    expect(await store.getAppleDevices(apple.pass.id)).toHaveLength(0);
    await store.registerAppleDevice(apple.pass.id, 'device', 'cc');
    await store.unregisterAppleDevice(apple.pass.id, 'device');
    expect(await store.getAppleDevices(apple.pass.id)).toHaveLength(0);
  });

  it('requeues a rotated Apple token during delivery and keeps same-token registration idempotent', async () => {
    const { pass } = await issue();
    const store = createWalletStore(db);
    await store.registerAppleDevice(pass.id, 'device', 'aa');
    const [oldDelivery] = await store.claimPendingPasses({ passId: pass.id });
    expect(await store.getAppleDevices(pass.id)).toEqual([{ deviceId: 'device', pushToken: 'aa' }]);
    expect(await store.registerAppleDevice(pass.id, 'device', 'bb')).toEqual({ created: false });
    const rotatedRevision = await revision(pass.id);
    expect(BigInt(rotatedRevision)).toBeGreaterThan(BigInt(oldDelivery.revision));
    await store.markSynced(oldDelivery);
    const [newDelivery] = await store.claimPendingPasses({ passId: pass.id });
    expect(newDelivery.revision).toBe(rotatedRevision);
    expect(await store.getAppleDevices(pass.id)).toEqual([{ deviceId: 'device', pushToken: 'bb' }]);
    await store.markSynced(newDelivery);
    expect(await store.registerAppleDevice(pass.id, 'device', 'bb')).toEqual({ created: false });
    expect(await revision(pass.id)).toBe(rotatedRevision);
    expect(await store.claimPendingPasses({ passId: pass.id })).toHaveLength(0);
  });

  it('serializes same-token registration with unregister and advances revision after removal', async () => {
    const { pass } = await issue();
    const store = createWalletStore(db);
    await store.registerAppleDevice(pass.id, 'device', 'aa');
    const before = await revision(pass.id);
    const guarded: Database = {
      ...db,
      transaction: (operation) =>
        db.transaction((tx) =>
          operation({
            ...tx,
            query: async <T>(sql: string, values?: unknown[]) => {
              if (
                sql.startsWith('SELECT push_token FROM wallet_devices') &&
                !/FOR UPDATE/i.test(sql)
              )
                throw new Error('Unregister can remove the device before registration finishes.');
              return tx.query<T>(sql, values);
            },
          }),
        ),
    };
    await expect(
      createWalletStore(guarded).registerAppleDevice(pass.id, 'device', 'aa'),
    ).resolves.toEqual({ created: false });
    expect(await revision(pass.id)).toBe(before);
    await store.unregisterAppleDevice(pass.id, 'device');
    expect(await store.registerAppleDevice(pass.id, 'device', 'aa')).toEqual({ created: true });
    const listing = await store.listAppleSerials('device', appleType, before);
    expect(listing?.serialNumbers).toEqual([pass.id]);
    expect(BigInt(listing!.lastUpdated)).toBeGreaterThan(BigInt(before));
  });

  it('lists two native cards with a global watermark that includes older-card registrations', async () => {
    const first = await issue();
    const older = await issue('other-member');
    const store = createWalletStore(db);
    await store.registerAppleDevice(first.pass.id, 'device', 'aa');
    await purchase('raise-first-global-revision');
    const initial = await store.listAppleSerials('device', appleType);
    expect(initial?.serialNumbers).toEqual([first.pass.id]);
    expect(await store.listAppleSerials('device', 'pass.org.other')).toBeNull();
    await store.registerAppleDevice(older.pass.id, 'device', 'aa');
    const added = await store.listAppleSerials('device', appleType, initial!.lastUpdated);
    expect(added?.serialNumbers).toEqual([older.pass.id]);
    expect(BigInt(added!.lastUpdated)).toBeGreaterThan(BigInt(initial!.lastUpdated));
    await purchase('raise-first-again');
    await db.transaction((tx) => enqueueMembershipWalletUpdates(tx, 'other-member'));
    const both = await store.listAppleSerials('device', appleType, added!.lastUpdated);
    expect(new Set(both?.serialNumbers)).toEqual(new Set([first.pass.id, older.pass.id]));
    expect(await store.listAppleSerials('device', appleType, both!.lastUpdated)).toBeNull();
  });

  it('has no economic side effects when no Wallet card has been issued', async () => {
    await purchase('ordinary-purchase');
    expect((await db.query('SELECT id FROM wallet_passes')).rows).toHaveLength(0);
    expect((await createLoyaltyService(db).getMembership(owner, 'member')).totalStamps).toBe(1);
  });
});
