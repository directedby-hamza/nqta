import { randomUUID } from 'node:crypto';
import type { Database } from '../src/server/db/client';
import type { Actor } from '../src/server/loyalty/types';
import { createLoyaltyService } from '../src/server/loyalty/service';
import { createPrivacyService } from '../src/server/privacy/service';
import { createProgrammeService } from '../src/server/loyalty/programme';
import { createCustomerService } from '../src/server/auth/customer';
import { createWalletStore, enqueueMembershipWalletUpdates } from '../src/server/wallet/store';
import type { WalletPass } from '../src/server/wallet/contracts';

export class DrillWalletError extends Error {
  constructor(readonly code: string) {
    super('Disposable Wallet drill failed.');
    this.name = 'DrillWalletError';
  }
}
export type WalletDrillState = {
  owner: Actor;
  customerId: string;
  membershipId: string;
  deviceId: string;
  passTypeId: string;
  passes: WalletPass[];
  purchaseKey: string;
  eventId: string;
  watermark: string;
};
function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new DrillWalletError(code);
}
function sqlState(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return;
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : undefined;
}
async function disposable(db: Database) {
  assert(db.dialect === 'postgres', 'wallet-postgres-required');
  const row = (
    await db.query<{ schema: string; backend_pid: number }>(
      'SELECT current_schema() AS schema,pg_backend_pid() AS backend_pid',
    )
  ).rows[0];
  assert(row && /^nqta_check_[a-f0-9]{32}$/.test(row.schema), 'wallet-disposable-schema-required');
  return row;
}
async function waitsForLock(db: Database, pid: number) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const row = (
      await db.query<{ wait_event_type: string | null }>(
        'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
        [pid],
      )
    ).rows[0];
    if (row?.wait_event_type === 'Lock') return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** Only caller-created disposable schemas are used. No providers or schema lifecycle occur here. */
export async function exerciseWalletConcurrency(
  first: Database,
  second: Database,
): Promise<{ checks: number; state: WalletDrillState }> {
  let checks = 0;
  const check = (condition: unknown, code: string) => {
    assert(condition, code);
    checks++;
  };
  const scopes = await Promise.all([disposable(first), disposable(second)]);
  check(
    first !== second &&
      scopes[0].schema === scopes[1].schema &&
      scopes[0].backend_pid !== scopes[1].backend_pid,
    'wallet-distinct-postgres-backends',
  );
  const suffix = randomUUID().replaceAll('-', '');
  const shopId = `wallet-shop-${suffix}`;
  const secondShopId = `wallet-other-shop-${suffix}`;
  const programmeId = `wallet-programme-${suffix}`;
  const otherProgrammeId = `wallet-other-programme-${suffix}`;
  const customerId = `wallet-customer-${suffix}`;
  const strangerId = `wallet-stranger-${suffix}`;
  const membershipId = `wallet-member-${suffix}`;
  const otherMemberId = `wallet-other-member-${suffix}`;
  const owner: Actor = { userId: `wallet-owner-${suffix}`, shopId, role: 'owner' };
  const otherOwner: Actor = {
    userId: `wallet-other-owner-${suffix}`,
    shopId: secondShopId,
    role: 'owner',
  };
  const deviceId = `wallet-device-${suffix}`;
  const passTypeId = 'pass.org.nqta.disposable';
  await first.query('INSERT INTO shops(id,slug,name) VALUES($1,$1,$3),($2,$2,$3)', [
    shopId,
    secondShopId,
    'Synthetic Wallet merchant',
  ]);
  for (const actor of [owner, otherOwner])
    await first.query(
      "INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES($1,$2,$1,$3,'synthetic-no-login','owner')",
      [actor.userId, actor.shopId, `${actor.userId}@example.invalid`],
    );
  await first.query(
    "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES($1,$2,5,'Synthetic reward','Synthetic paid receipt','published'),($3,$4,5,'Synthetic reward','Synthetic paid receipt','published')",
    [programmeId, shopId, otherProgrammeId, secondShopId],
  );
  await first.query(
    "INSERT INTO customers(id,name) VALUES($1,'Synthetic Wallet member'),($2,'Synthetic other member')",
    [customerId, strangerId],
  );
  await first.query(
    'INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$4,$9)',
    [
      membershipId,
      shopId,
      programmeId,
      customerId,
      `NQ-WALLET-${suffix}`,
      otherMemberId,
      secondShopId,
      otherProgrammeId,
      `NQ-OTHER-WALLET-${suffix}`,
    ],
  );
  const stores = [createWalletStore(first), createWalletStore(second)];
  const issued = await Promise.all(
    stores.map((store) => store.getOrCreatePass(customerId, membershipId, 'apple', passTypeId)),
  );
  check(issued[0].pass.id === issued[1].pass.id, 'wallet-stable-concurrent-issuance');
  const primary = issued[0].pass;
  const other = (await stores[1].getOrCreatePass(customerId, otherMemberId, 'apple', passTypeId))
    .pass;
  const google = (
    await stores[0].getOrCreatePass(customerId, membershipId, 'google', `123.wallet_${suffix}`)
  ).pass;
  const denied = await Promise.allSettled([
    stores[1].getOrCreatePass(strangerId, membershipId, 'apple', passTypeId),
  ]);
  if (denied[0].status === 'rejected' && sqlState(denied[0].reason))
    throw new DrillWalletError(`postgres-${sqlState(denied[0].reason)}`);
  check(denied[0].status === 'rejected', 'wallet-ownership-rejection');

  // Preferences hold S→M before requesting C. Issuance must wait on S before
  // obtaining C, or the two operations form the C→M / M→C deadlock cycle.
  let preferencesLocked!: () => void;
  let releasePreferences!: () => void;
  let issuanceStarted!: (pid: number) => void;
  const preferencesReady = new Promise<void>((resolve) => {
    preferencesLocked = resolve;
  });
  const releasePreferencesGate = new Promise<void>((resolve) => {
    releasePreferences = resolve;
  });
  const issuancePid = new Promise<number>((resolve) => {
    issuanceStarted = resolve;
  });
  const preferenceBoundary: Database = {
    ...second,
    transaction: (operation) =>
      second.transaction((tx) =>
        operation({
          ...tx,
          query: async <T>(sql: string, values?: unknown[]) => {
            const result = await tx.query<T>(sql, values);
            if (/SELECT id FROM memberships.*FOR UPDATE/i.test(sql)) {
              preferencesLocked();
              await releasePreferencesGate;
            }
            return result;
          },
        }),
      ),
  };
  const preferences = createCustomerService(preferenceBoundary).updatePreferences(
    customerId,
    membershipId,
    { sms: false, whatsapp: false },
  );
  await Promise.race([preferencesReady, preferences]);
  const issuanceBoundary: Database = {
    ...first,
    transaction: (operation) =>
      first.transaction(async (tx) => {
        issuanceStarted(
          (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );
        return operation(tx);
      }),
  };
  const issuance = createWalletStore(issuanceBoundary).getOrCreatePass(
    customerId,
    membershipId,
    'apple',
    passTypeId,
  );
  let issuanceWaiting = false;
  try {
    const pid = await Promise.race([issuancePid, issuance.then(() => null)]);
    assert(pid !== null, 'wallet-preferences-issuance-started');
    issuanceWaiting = await waitsForLock(first, pid);
  } finally {
    releasePreferences();
    await Promise.all([preferences, issuance]);
  }
  check(issuanceWaiting, 'wallet-preferences-issuance-shop-serialization');
  check(
    (await stores[0].getPassBySerial('apple', primary.id))!.card.status === 'active',
    'wallet-preferences-issuance-no-deadlock',
  );
  const registration = await stores[0].registerAppleDevice(primary.id, deviceId, 'aa');
  check(registration.created, 'wallet-native-registration');
  check(
    !(await stores[1].registerAppleDevice(primary.id, deviceId, 'bb')).created,
    'wallet-native-registration-idempotency',
  );
  await stores[0].removeAppleDevice(primary.id, deviceId, 'aa');
  check(
    (await stores[0].getAppleDevices(primary.id))[0]?.pushToken === 'bb',
    'wallet-native-stale-token-preserved',
  );
  const firstListing = await stores[0].listAppleSerials(deviceId, passTypeId);
  check(
    firstListing?.serialNumbers.length === 1 && firstListing.serialNumbers[0] === primary.id,
    'wallet-native-first-listing',
  );
  await stores[1].registerAppleDevice(other.id, deviceId, 'bb');
  const addedListing = await stores[0].listAppleSerials(
    deviceId,
    passTypeId,
    firstListing!.lastUpdated,
  );
  check(
    addedListing?.serialNumbers.length === 1 &&
      addedListing.serialNumbers[0] === other.id &&
      BigInt(addedListing.lastUpdated) > BigInt(firstListing!.lastUpdated),
    'wallet-native-older-card-watermark',
  );
  check(
    (await stores[1].listAppleSerials(deviceId, 'pass.org.other')) === null,
    'wallet-native-pass-type-scope',
  );

  // A same-token POST must hold its existing registration through commit. If a
  // concurrent DELETE can remove it after lookup, UPSERT silently recreates the
  // device without a revision bump and misses the device's newer watermark.
  let registrationLookedUp!: () => void;
  let releaseRegistration!: () => void;
  let unregisterStarted!: (pid: number) => void;
  const registrationReady = new Promise<void>((resolve) => {
    registrationLookedUp = resolve;
  });
  const registrationGate = new Promise<void>((resolve) => {
    releaseRegistration = resolve;
  });
  const unregisterPid = new Promise<number>((resolve) => {
    unregisterStarted = resolve;
  });
  const registrationBoundary: Database = {
    ...first,
    transaction: (operation) =>
      first.transaction((tx) =>
        operation({
          ...tx,
          query: async <T>(sql: string, values?: unknown[]) => {
            const result = await tx.query<T>(sql, values);
            if (sql.startsWith('SELECT push_token FROM wallet_devices')) {
              registrationLookedUp();
              await registrationGate;
            }
            return result;
          },
        }),
      ),
  };
  const sameTokenPost = createWalletStore(registrationBoundary).registerAppleDevice(
    primary.id,
    deviceId,
    'bb',
  );
  await Promise.race([registrationReady, sameTokenPost]);
  const concurrentUnregister = second.transaction(async (tx) => {
    unregisterStarted(
      (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
    );
    await createWalletStore(tx).unregisterAppleDevice(primary.id, deviceId);
  });
  let unregisterWaiting = false;
  try {
    const pid = await Promise.race([unregisterPid, concurrentUnregister.then(() => null)]);
    assert(pid !== null, 'wallet-unregister-overlap-started');
    unregisterWaiting = await waitsForLock(first, pid);
  } finally {
    releaseRegistration();
    await Promise.all([sameTokenPost, concurrentUnregister]);
  }
  check(unregisterWaiting, 'wallet-unregister-waits-for-registration-ack');
  check(
    !(await sameTokenPost).created && (await stores[0].getAppleDevices(primary.id)).length === 0,
    'wallet-registration-before-unregister-order',
  );
  check(
    (await stores[0].registerAppleDevice(primary.id, deviceId, 'bb')).created,
    'wallet-reregister-after-unregister-created',
  );
  const reregisteredListing = await stores[1].listAppleSerials(
    deviceId,
    passTypeId,
    addedListing!.lastUpdated,
  );
  check(
    reregisteredListing?.serialNumbers.length === 1 &&
      reregisteredListing.serialNumbers[0] === primary.id &&
      BigInt(reregisteredListing.lastUpdated) > BigInt(addedListing!.lastUpdated),
    'wallet-reregister-newer-than-other-card-watermark',
  );

  const claims = (
    await Promise.all(
      stores.map((store) =>
        store.claimPendingPasses({ passId: primary.id, providers: ['apple'], limit: 1 }),
      ),
    )
  ).flat();
  check(claims.length === 1 && !!claims[0].lockToken, 'wallet-concurrent-single-lease');
  const claim = claims[0];
  check(
    !(await stores[1].registerAppleDevice(primary.id, deviceId, 'cc')).created,
    'wallet-native-token-rotation-existing-device',
  );
  const rotated = (await stores[0].getPassBySerial('apple', primary.id))!.pass;
  check(
    BigInt(rotated.revision) > BigInt(claim.revision),
    'wallet-token-rotation-during-delivery-enqueued',
  );
  await stores[1].registerAppleDevice(primary.id, deviceId, 'cc');
  check(
    (await stores[0].getPassBySerial('apple', primary.id))!.pass.revision === rotated.revision,
    'wallet-same-token-registration-idempotency',
  );
  await stores[0].removeAppleDevice(primary.id, deviceId, 'bb');
  check(
    (await stores[0].getAppleDevices(primary.id))[0]?.pushToken === 'cc',
    'wallet-rotated-token-not-removed-by-old-delivery',
  );
  const purchaseKey = `wallet-purchase-${suffix}`;
  const purchaseInput = {
    membershipId,
    qualifies: true,
    amountMinor: 100,
    idempotencyKey: purchaseKey,
  };
  const saved = await createLoyaltyService(second).recordPurchase(owner, purchaseInput);
  const changed = (await stores[0].getPassBySerial('apple', primary.id))!;
  check(
    changed.card.totalStamps === 1 && BigInt(changed.pass.revision) > BigInt(claim.revision),
    'wallet-atomic-purchase-enqueue',
  );
  await stores[1].markSynced({ ...claim, revision: changed.pass.revision });
  check(
    (await stores[0].getPassBySerial('apple', primary.id))!.pass.syncedRevision === '0',
    'wallet-uncaptured-revision-ack-rejected',
  );
  await stores[0].markSynced(claim);
  const [next] = await stores[1].claimPendingPasses({ passId: primary.id });
  check(
    next?.revision === changed.pass.revision && next.syncedRevision === claim.revision,
    'wallet-newer-revision-remains-pending',
  );
  check(
    (await stores[1].getAppleDevices(primary.id))[0]?.pushToken === 'cc',
    'wallet-next-delivery-targets-rotated-token',
  );
  const beforeReplay = next.revision;
  check(
    (await createLoyaltyService(first).recordPurchase(owner, purchaseInput)).eventId ===
      saved.eventId,
    'wallet-purchase-idempotency',
  );
  check(
    (await stores[0].getPassBySerial('apple', primary.id))!.pass.revision === beforeReplay,
    'wallet-idempotency-no-reenqueue',
  );
  await first.query("UPDATE wallet_passes SET lease_until=NOW()-interval '1 second' WHERE id=$1", [
    primary.id,
  ]);
  await stores[0].markSynced(next);
  check(
    (await stores[0].getPassBySerial('apple', primary.id))!.pass.syncedRevision === claim.revision,
    'wallet-expired-lease-ack-rejected',
  );
  const [reclaimed] = await stores[0].claimPendingPasses({ passId: primary.id });
  check(reclaimed?.lockToken !== next.lockToken, 'wallet-expired-lease-reclaimed');
  await stores[1].markFailed(next);
  await stores[1].markSynced(next);
  await stores[0].markSynced(reclaimed);
  check(
    (await stores[0].claimPendingPasses({ passId: primary.id })).length === 0,
    'wallet-stale-worker-no-interference',
  );

  const beforeRollback = (await stores[0].getPassBySerial('apple', primary.id))!.pass.revision;
  try {
    await first.transaction(async (tx) => {
      await enqueueMembershipWalletUpdates(tx, membershipId);
      throw new DrillWalletError('wallet-intentional-rollback');
    });
  } catch (error) {
    if (!(error instanceof DrillWalletError) || error.code !== 'wallet-intentional-rollback')
      throw error;
  }
  check(
    (await stores[0].getPassBySerial('apple', primary.id))!.pass.revision === beforeRollback,
    'wallet-queue-rollback',
  );

  // Hold the first allocation until the other backend is visibly waiting on it.
  // This proves revision order follows commit order across different memberships.
  let releaseAllocation!: () => void;
  let allocationReady!: () => void;
  let contenderReady!: (pid: number) => void;
  const release = new Promise<void>((resolve) => {
    releaseAllocation = resolve;
  });
  const allocated = new Promise<void>((resolve) => {
    allocationReady = resolve;
  });
  const contenderPid = new Promise<number>((resolve) => {
    contenderReady = resolve;
  });
  const firstUpdate = first.transaction(async (tx) => {
    await enqueueMembershipWalletUpdates(tx, membershipId);
    allocationReady();
    await release;
  });
  await Promise.race([allocated, firstUpdate]);
  const secondUpdate = second.transaction(async (tx) => {
    contenderReady((await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    await enqueueMembershipWalletUpdates(tx, otherMemberId);
  });
  let waiting = false;
  try {
    const pid = await Promise.race([contenderPid, secondUpdate.then(() => null)]);
    assert(pid !== null, 'wallet-allocation-contender-started');
    waiting = await waitsForLock(first, pid);
  } finally {
    releaseAllocation();
    await Promise.all([firstUpdate, secondUpdate]);
  }
  check(waiting, 'wallet-revision-allocation-serialized-until-commit');
  const currentFirst = (await stores[0].getPassBySerial('apple', primary.id))!.pass;
  const currentOther = (await stores[1].getPassBySerial('apple', other.id))!.pass;
  check(
    BigInt(currentOther.revision) > BigInt(currentFirst.revision),
    'wallet-cross-card-commit-order',
  );
  const combined = await stores[0].listAppleSerials(
    deviceId,
    passTypeId,
    addedListing!.lastUpdated,
  );
  check(combined?.serialNumbers.length === 2, 'wallet-cross-card-updates-not-missed');

  await createProgrammeService(first).pauseShop(owner, true);
  check(
    (await stores[1].getPassBySerial('apple', primary.id))!.card.shopStatus === 'paused',
    'wallet-shop-pause',
  );
  const deletionRequest = `wallet-delete-${suffix}`;
  await first.query(
    "INSERT INTO support_requests(id,shop_id,membership_id,kind,message) VALUES($1,$2,$3,'deletion','Synthetic deletion')",
    [deletionRequest, secondShopId, otherMemberId],
  );
  await createPrivacyService(second).fulfilDeletion(
    otherOwner,
    deletionRequest,
    'Synthetic customer confirmed Wallet deletion.',
  );
  const closed = (await stores[0].getPassBySerial('apple', other.id))!;
  check(
    closed.card.status === 'closed' &&
      closed.card.name === 'Removed member' &&
      closed.card.memberCode !== `NQ-OTHER-WALLET-${suffix}`,
    'wallet-privacy-closed-refresh',
  );
  const closedIssue = await Promise.allSettled([
    stores[1].getOrCreatePass(customerId, otherMemberId, 'apple', passTypeId),
  ]);
  if (closedIssue[0].status === 'rejected' && sqlState(closedIssue[0].reason))
    throw new DrillWalletError(`postgres-${sqlState(closedIssue[0].reason)}`);
  check(closedIssue[0].status === 'rejected', 'wallet-privacy-issuance-denied');
  const passes = await Promise.all(
    [primary, other, google].map(
      async (pass) => (await stores[0].getPassBySerial(pass.provider, pass.id))!.pass,
    ),
  );
  const watermark = (await stores[0].listAppleSerials(deviceId, passTypeId))!.lastUpdated;
  return {
    checks,
    state: {
      owner,
      customerId,
      membershipId,
      deviceId,
      passTypeId,
      passes,
      purchaseKey,
      eventId: saved.eventId,
      watermark,
    },
  };
}

/** Verify Wallet rows, devices, queue state and the owned global allocator after encrypted restore. */
export async function verifyWalletRestore(
  restored: Database,
  state: WalletDrillState,
): Promise<number> {
  await disposable(restored);
  let checks = 0;
  const check = (condition: unknown, code: string) => {
    assert(condition, code);
    checks++;
  };
  const store = createWalletStore(restored);
  for (const expected of state.passes) {
    const result = await store.getPassBySerial(expected.provider, expected.id);
    check(
      result &&
        result.pass.id === expected.id &&
        result.pass.externalId === expected.externalId &&
        result.pass.revision === expected.revision &&
        result.pass.syncedRevision === expected.syncedRevision,
      'wallet-restored-pass',
    );
  }
  const listing = await store.listAppleSerials(state.deviceId, state.passTypeId);
  check(
    listing?.serialNumbers.length === 2 && listing.lastUpdated === state.watermark,
    'wallet-restored-native-watermark',
  );
  check(
    (await store.getAppleDevices(state.passes[0].id))[0]?.pushToken === 'cc',
    'wallet-restored-native-device',
  );
  const replay = await createLoyaltyService(restored).recordPurchase(state.owner, {
    membershipId: state.membershipId,
    qualifies: true,
    amountMinor: 100,
    idempotencyKey: state.purchaseKey,
  });
  check(replay.eventId === state.eventId, 'wallet-restored-purchase-idempotency');
  const maximum = state.passes.reduce(
    (value, pass) => (BigInt(pass.revision) > value ? BigInt(pass.revision) : value),
    0n,
  );
  await restored.transaction((tx) => enqueueMembershipWalletUpdates(tx, state.membershipId));
  const refreshed = (await store.getPassBySerial('apple', state.passes[0].id))!;
  check(BigInt(refreshed.pass.revision) > maximum, 'wallet-restored-owned-revision-sequence');
  const [claim] = await store.claimPendingPasses({ passId: refreshed.pass.id });
  check(claim?.revision === refreshed.pass.revision, 'wallet-restored-pending-queue');
  await store.markSynced(claim);
  check(
    (await store.claimPendingPasses({ passId: claim.id })).length === 0,
    'wallet-restored-queue-ack',
  );
  return checks;
}
