import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fixture, owner } from './fixture';
import type { Database } from '../../src/server/db/client';
import { createWalletStore, enqueueMembershipWalletUpdates } from '../../src/server/wallet/store';
import { createLoyaltyService } from '../../src/server/loyalty/service';
import { flushWalletUpdates } from '../../src/server/wallet/delivery';

const transport = vi.hoisted(() => ({ google: vi.fn(), apple: vi.fn() }));
vi.mock('../../src/server/wallet/options', () => ({
  walletOptions: () => ({ google: true, apple: true }),
}));
vi.mock('../../src/server/wallet/google', () => ({ syncGoogleWalletPass: transport.google }));
vi.mock('../../src/server/wallet/apple', () => ({
  pushAppleWalletUpdates: transport.apple,
  applePassTypeIdentifier: () => 'pass.org.nqta.loyalty',
}));
let db: Database;
let sequence = 0;
beforeAll(async () => {
  db = await fixture();
  await db.query("INSERT INTO customers(id,name) VALUES('wallet-customer','Mina')");
});
afterAll(async () => {
  await db?.close();
});
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  transport.google.mockReset().mockResolvedValue(undefined);
  transport.apple.mockReset().mockResolvedValue([]);
});
async function issue(provider: 'google' | 'apple' = 'google') {
  const membershipId = 'delivery-member-' + ++sequence;
  const customerId = 'delivery-customer-' + sequence;
  await db.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customerId, 'Mina']);
  await db.query(
    'INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES($1,$2,$3,$4,$5)',
    [membershipId, 'shop', 'programme', customerId, 'NQ-DELIVERY-' + sequence],
  );
  return createWalletStore(db).getOrCreatePass(
    customerId,
    membershipId,
    provider,
    provider === 'apple' ? 'pass.org.nqta.loyalty' : '123.object_' + sequence,
  );
}
it('keeps a failed provider update queued without undoing or duplicating the saved purchase', async () => {
  const { pass } = await issue();
  const input = {
    membershipId: pass.membershipId,
    idempotencyKey: 'delivery-purchase',
    qualifies: true,
  };
  const loyalty = createLoyaltyService(db);
  const saved = await loyalty.recordPurchase(owner, input);
  transport.google.mockRejectedValue(new Error('provider private failure'));
  expect(await flushWalletUpdates(db, { passId: pass.id })).toEqual({ delivered: 0, failed: 1 });
  expect(await loyalty.recordPurchase(owner, input)).toEqual(saved);
  const card = await createWalletStore(db).getPassBySerial('google', pass.id);
  expect(card?.card.totalStamps).toBe(1);
  expect(card?.pass.syncedRevision).toBe('0');
  expect(
    (
      await db.query("SELECT id FROM events WHERE membership_id=$1 AND kind='purchase'", [
        pass.membershipId,
      ])
    ).rows,
  ).toHaveLength(1);
});
it('never acknowledges a mutation saved while the provider is delivering an earlier revision', async () => {
  const { pass } = await issue();
  transport.google.mockImplementation(async () => {
    await db.transaction((tx) => enqueueMembershipWalletUpdates(tx, pass.membershipId));
  });
  expect(await flushWalletUpdates(db, { passId: pass.id })).toEqual({ delivered: 1, failed: 0 });
  const current = await createWalletStore(db).getPassBySerial('google', pass.id);
  expect(current?.pass.syncedRevision).toBe(pass.revision);
  expect(BigInt(current!.pass.revision)).toBeGreaterThan(BigInt(current!.pass.syncedRevision));
});
it('rejects a stolen delivery lease before sending any provider update', async () => {
  const { pass } = await issue();
  let transferred = false;
  const guarded: Database = {
    ...db,
    transaction: (operation) =>
      db.transaction((tx) =>
        operation({
          ...tx,
          query: async <T>(sql: string, values?: unknown[]) => {
            if (!transferred && sql.includes('WHERE p.id=$1 AND p.provider=$2')) {
              transferred = true;
              await tx.query("UPDATE wallet_passes SET lock_token='new-worker' WHERE id=$1", [
                pass.id,
              ]);
            }
            return tx.query<T>(sql, values);
          },
        }),
      ),
  };
  expect(await flushWalletUpdates(guarded, { passId: pass.id })).toEqual({
    delivered: 0,
    failed: 1,
  });
  expect(transport.google).not.toHaveBeenCalled();
});
it('does not start a provider request after database waits consume its lease budget', async () => {
  const { pass } = await issue();
  vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(16001);
  expect(await flushWalletUpdates(db, { passId: pass.id })).toEqual({ delivered: 0, failed: 1 });
  expect(transport.google).not.toHaveBeenCalled();
});
it('removes an invalid Apple device only for the delivered pass and retries transient failures', async () => {
  const a = await issue('apple');
  const b = await issue('apple');
  const store = createWalletStore(db);
  await store.registerAppleDevice(a.pass.id, 'shared-device', 'ab'.repeat(32));
  await store.registerAppleDevice(b.pass.id, 'shared-device', 'ab'.repeat(32));
  await store.registerAppleDevice(a.pass.id, 'retry-device', 'cd'.repeat(32));
  transport.apple.mockResolvedValue([
    { token: 'ab'.repeat(32), status: 'remove' },
    { token: 'cd'.repeat(32), status: 'retry' },
  ]);
  expect(await flushWalletUpdates(db, { passId: a.pass.id })).toEqual({ delivered: 0, failed: 1 });
  expect(await store.getAppleDevices(a.pass.id)).toEqual([
    { deviceId: 'retry-device', pushToken: 'cd'.repeat(32) },
  ]);
  expect(await store.getAppleDevices(b.pass.id)).toHaveLength(1);
});
