import { randomUUID } from 'node:crypto';
import { createDatabase, type Database } from '../src/server/db/client';
import { migrate } from '../src/server/db/migrate';
import {
  BackupError,
  createEncryptedBackup,
  restoreEncryptedBackup,
} from '../src/server/db/backup';
import { createCustomerService } from '../src/server/auth/customer';
import { createLoyaltyService } from '../src/server/loyalty/service';
import { createPrivacyService } from '../src/server/privacy/service';
import type { Actor } from '../src/server/loyalty/types';
import {
  DrillKeyError,
  exerciseKeyAuthConcurrency,
  verifyKeyAuthRestore,
} from './check-key-auth-postgres';
import {
  DrillWalletError,
  exerciseWalletConcurrency,
  verifyWalletRestore,
} from './check-wallet-postgres';

type DrillStage =
  | 'configuration'
  | 'schema-create'
  | 'pool-open'
  | 'migrate'
  | 'seed'
  | 'duplicate-purchases'
  | 'threshold-purchases'
  | 'redemptions'
  | 'reversals'
  | 'tenant-isolation'
  | 'consents'
  | 'key-auth'
  | 'restore-key-auth'
  | 'wallet'
  | 'restore-wallet'
  | 'deletion-reward-fixture'
  | 'deletion-reward-overlap'
  | 'deletion-verification-fixture'
  | 'deletion-verification-overlap'
  | 'deletion-challenge-fixture'
  | 'deletion-challenge-overlap'
  | 'deletion-preferences-fixture'
  | 'deletion-preferences-overlap'
  | 'snapshot'
  | 'restore'
  | 'restore-table-counts'
  | 'restore-idempotency'
  | 'restore-consents'
  | 'cleanup';

function sqlState(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return;
  const code = error.code;
  if (typeof code !== 'string') return;
  if (/^[0-9A-Z]{5}$/.test(code)) return code;
  if (/^postgres-[0-9A-Z]{5}$/.test(code)) return code.slice('postgres-'.length);
}

class DrillError extends Error {
  constructor(readonly code: string) {
    super('Disposable database drill failed.');
  }
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new DrillError(code);
}

function rejectDatabaseErrors(results: PromiseSettledResult<unknown>[]) {
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    const code =
      result.reason && typeof result.reason === 'object' ? result.reason.code : undefined;
    // A business rejection can be expected after a winning concurrent operation;
    // any PostgreSQL error (including 40P01) always fails the drill.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code))
      throw new DrillError(`postgres-${code}`);
  }
}

async function count(db: Database, sql: string, values: unknown[] = []) {
  return Number((await db.query<{ count: string }>(sql, values)).rows[0].count);
}

/** All records are synthetic and belong to the caller's disposable schema. */
export async function exerciseDatabaseConcurrency(
  first: Database,
  second: Database,
  onStage: (stage: DrillStage) => void = () => {},
): Promise<number> {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    DEMO_MODE: process.env.DEMO_MODE,
    HOSTED_TEST_MODE: process.env.HOSTED_TEST_MODE,
  };
  // Synthetic delivery is enforced in this process, even if the operator loaded production configuration.
  Object.assign(process.env, { NODE_ENV: 'test', DEMO_MODE: 'true', HOSTED_TEST_MODE: 'false' });
  let checks = 0;
  const check = (condition: unknown, code: string) => {
    assert(condition, code);
    checks++;
  };
  try {
    onStage('seed');
    const owner: Actor = { userId: 'drill-owner', shopId: 'drill-shop', role: 'owner' };
    const cashier: Actor = { userId: 'drill-cashier', shopId: 'drill-shop', role: 'cashier' };
    const other: Actor = { userId: 'drill-other-owner', shopId: 'drill-other', role: 'owner' };
    await first.query(
      "INSERT INTO shops(id,slug,name,privacy_notice,privacy_contact) VALUES('drill-shop','drill-shop','Synthetic drill merchant','Synthetic privacy notice','privacy@example.invalid'),('drill-other','drill-other','Synthetic second merchant','Synthetic privacy notice','other@example.invalid')",
    );
    for (const actor of [owner, cashier, other])
      await first.query(
        'INSERT INTO staff(id,shop_id,name,email,password_hash,role,email_verified) VALUES($1,$2,$1,$3,$4,$5,true)',
        [
          actor.userId,
          actor.shopId,
          `${actor.userId}@example.invalid`,
          'synthetic-no-login',
          actor.role,
        ],
      );
    await first.query(
      "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('drill-programme','drill-shop',5,'Synthetic reward','Synthetic purchase','published'),('drill-other-programme','drill-other',5,'Synthetic other reward','Synthetic purchase','published')",
    );
    const customers = [
      createCustomerService(first, { development: true }),
      createCustomerService(second, { development: true }),
    ];
    const loyalty = [createLoyaltyService(first), createLoyaltyService(second)];
    const privacy = [createPrivacyService(first), createPrivacyService(second)];
    await first.query(
      "INSERT INTO customers(id,phone,name) VALUES('drill-customer','+212600008001','Synthetic customer'),('drill-other-customer','+212600008002','Synthetic other customer')",
    );
    const member = await customers[0].joinProgramme(
      'drill-customer',
      'drill-programme',
      'Synthetic customer',
      { sms: false, whatsapp: false },
    );
    const otherMember = await customers[0].joinProgramme(
      'drill-other-customer',
      'drill-other-programme',
      'Synthetic other customer',
      { sms: false, whatsapp: false },
    );
    const purchase = {
      membershipId: member.id,
      qualifies: true,
      amountMinor: 2500,
      receiptReference: 'drill-duplicate',
      idempotencyKey: 'drill-duplicate',
    };
    onStage('duplicate-purchases');
    const duplicates = await Promise.all(
      Array.from({ length: 6 }, (_, index) => loyalty[index % 2].recordPurchase(owner, purchase)),
    );
    check(new Set(duplicates.map((result) => result.eventId)).size === 1, 'duplicate-purchase');
    check(
      (await count(
        first,
        "SELECT COUNT(*) FROM events WHERE membership_id=$1 AND kind='purchase'",
        [member.id],
      )) === 1,
      'duplicate-event-count',
    );
    onStage('threshold-purchases');
    const purchases = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        loyalty[index % 2].recordPurchase(index % 2 ? cashier : owner, {
          membershipId: member.id,
          qualifies: true,
          amountMinor: 2500,
          receiptReference: `drill-threshold-${index}`,
          idempotencyKey: `drill-threshold-${index}`,
        }),
      ),
    );
    let card = await loyalty[0].getMembership(owner, member.id);
    check(
      card.totalStamps === 5 && card.rewards.length === 1 && card.rewards[0].state === 'available',
      'threshold-entitlement',
    );
    const reward = card.rewards[0];
    onStage('redemptions');
    const challenge = await customers[0].createRedemptionChallenge('drill-customer', reward.id);
    const redemptions = await Promise.allSettled(
      loyalty.map((service, index) =>
        service.redeemReward(index ? cashier : owner, {
          rewardId: reward.id,
          challengeId: challenge.challengeId,
          code: challenge.code,
          idempotencyKey: `drill-redeem-${index}`,
        }),
      ),
    );
    rejectDatabaseErrors(redemptions);
    check(
      redemptions.filter((result) => result.status === 'fulfilled').length === 1,
      'single-redemption',
    );
    check(
      (await count(
        first,
        "SELECT COUNT(*) FROM events WHERE membership_id=$1 AND kind='redemption'",
        [member.id],
      )) === 1,
      'single-redemption-event',
    );
    onStage('reversals');
    const reversal = {
      eventId: purchases[3].eventId,
      reason: 'Synthetic refund overlap',
      idempotencyKey: 'drill-reversal',
    };
    await Promise.all(
      loyalty.map((service, index) =>
        service.reversePurchase(owner, { ...reversal, idempotencyKey: `drill-reversal-${index}` }),
      ),
    );
    check(
      (await count(
        first,
        "SELECT COUNT(*) FROM events WHERE original_event_id=$1 AND kind='reversal'",
        [reversal.eventId],
      )) === 1,
      'single-reversal',
    );
    check(
      (await count(first, 'SELECT COUNT(*) FROM ledger WHERE membership_id=$1 AND delta=-1', [
        member.id,
      ])) === 1,
      'single-reversal-ledger',
    );
    card = await loyalty[0].getMembership(owner, member.id);
    check(
      card.totalStamps === 4 && card.needsReview && card.rewards[0].state === 'redeemed',
      'refund-integrity',
    );
    onStage('tenant-isolation');
    const foreign = await Promise.allSettled([
      loyalty[1].getMembership(other, member.id),
      loyalty[1].recordPurchase(other, {
        ...purchase,
        receiptReference: 'drill-foreign',
        idempotencyKey: 'drill-foreign',
      }),
      customers[1].updatePreferences('drill-other-customer', member.id, {
        sms: true,
        whatsapp: true,
      }),
      customers[1].requestDeletion('drill-other-customer', member.id),
      customers[1].createRedemptionChallenge('drill-other-customer', reward.id),
    ]);
    rejectDatabaseErrors(foreign);
    check(
      foreign.every((result) => result.status === 'rejected'),
      'tenant-isolation',
    );
    check(
      (await customers[0].getCard('drill-other-customer', otherMember.id)).totalStamps === 0,
      'foreign-balance-isolation',
    );
    onStage('consents');
    await Promise.all(
      customers.map((service, index) =>
        service.updatePreferences(
          'drill-customer',
          member.id,
          index ? { sms: false, whatsapp: true } : { sms: true, whatsapp: false },
        ),
      ),
    );
    const consent = (await customers[0].getCard('drill-customer', member.id)).consents!;
    check(consent.sms !== consent.whatsapp, 'atomic-consent-pair');

    async function deletionFixture(index: number, crossShop = false) {
      const customerId = `drill-delete-customer-${index}`;
      const phone = `+2126000081${String(index).padStart(2, '0')}`;
      await first.query('INSERT INTO customers(id,phone,name) VALUES($1,$2,$3)', [
        customerId,
        phone,
        'Synthetic deletion customer',
      ]);
      const local = await customers[0].joinProgramme(customerId, 'drill-programme', '', {
        sms: true,
        whatsapp: true,
      });
      const preserved = crossShop
        ? await customers[0].joinProgramme(customerId, 'drill-other-programme', '', {
            sms: true,
            whatsapp: false,
          })
        : undefined;
      await customers[0].requestDeletion(customerId, local.id);
      const requestId = (
        await first.query<{ id: string }>(
          "SELECT id FROM support_requests WHERE membership_id=$1 AND kind='deletion' AND status='open'",
          [local.id],
        )
      ).rows[0].id;
      return { customerId, phone, memberId: local.id, requestId, preserved };
    }
    async function assertDeleted(fixture: Awaited<ReturnType<typeof deletionFixture>>) {
      const state = (
        await first.query<{ status: string; customer_id: string }>(
          'SELECT status,customer_id FROM memberships WHERE id=$1',
          [fixture.memberId],
        )
      ).rows[0];
      check(
        state.status === 'closed' && state.customer_id !== fixture.customerId,
        'deletion-closed',
      );
      check(
        (await count(
          first,
          "SELECT COUNT(*) FROM support_requests WHERE membership_id=$1 AND kind='deletion' AND status='open'",
          [fixture.memberId],
        )) === 0,
        'deletion-resolved',
      );
      const access = await Promise.allSettled([
        customers[0].getCard(fixture.customerId, fixture.memberId),
      ]);
      rejectDatabaseErrors(access);
      check(access[0].status === 'rejected', 'deleted-identity-access');
      const latest = (
        await first.query<{ opted_in: boolean }>(
          'SELECT DISTINCT ON(channel) opted_in FROM consents WHERE membership_id=$1 ORDER BY channel,sequence DESC',
          [fixture.memberId],
        )
      ).rows;
      check(latest.length === 2 && latest.every((row) => !row.opted_in), 'deleted-consents');
    }
    const resolution = 'Synthetic disposable drill deletion completed.';
    onStage('deletion-reward-fixture');
    const rewardDeletion = await deletionFixture(1, true);
    // Arrange the reward sequentially so setup does not add a five-write shop-lock queue.
    for (let index = 0; index < 5; index++) {
      await loyalty[index % 2].recordPurchase(owner, {
        membershipId: rewardDeletion.memberId,
        qualifies: true,
        receiptReference: `drill-delete-reward-${index}`,
        idempotencyKey: `drill-delete-reward-${index}`,
      });
    }
    const deletionReward = (await loyalty[0].getMembership(owner, rewardDeletion.memberId))
      .rewards[0];
    onStage('deletion-reward-overlap');
    const rewardOverlap = await Promise.allSettled([
      customers[1].createRedemptionChallenge(rewardDeletion.customerId, deletionReward.id),
      privacy[0].fulfilDeletion(owner, rewardDeletion.requestId, resolution),
    ]);
    rejectDatabaseErrors(rewardOverlap);
    check(rewardOverlap[1].status === 'fulfilled', 'deletion-reward-overlap');
    await assertDeleted(rewardDeletion);
    check(
      (await count(first, 'SELECT COUNT(*) FROM redemption_challenges WHERE reward_id=$1', [
        deletionReward.id,
      ])) === 0,
      'deleted-reward-challenges',
    );
    check(
      (await customers[0].getCard(rewardDeletion.customerId, rewardDeletion.preserved!.id))
        .status === 'active',
      'deletion-other-merchant-preserved',
    );

    onStage('deletion-verification-fixture');
    const otpDeletion = await deletionFixture(2);
    const otp = await customers[0].requestVerification(otpDeletion.phone);
    assert(otp.developmentCode, 'synthetic-verification');
    onStage('deletion-verification-overlap');
    const otpOverlap = await Promise.allSettled([
      customers[1].verifyCode(otp.challengeId, otp.developmentCode),
      privacy[0].fulfilDeletion(owner, otpDeletion.requestId, resolution),
    ]);
    rejectDatabaseErrors(otpOverlap);
    check(otpOverlap[1].status === 'fulfilled', 'deletion-verification-overlap');
    await assertDeleted(otpDeletion);
    check(
      (await count(
        first,
        "SELECT COUNT(*) FROM sessions WHERE principal_id=$1 AND kind='customer'",
        [otpDeletion.customerId],
      )) === 0,
      'deleted-verification-session',
    );
    check(
      (await count(first, 'SELECT COUNT(*) FROM verification_challenges WHERE phone=$1', [
        otpDeletion.phone,
      ])) === 0,
      'deleted-phone-challenges',
    );

    onStage('deletion-challenge-fixture');
    const writeDeletion = await deletionFixture(3);
    onStage('deletion-challenge-overlap');
    const writeOverlap = await Promise.allSettled([
      customers[1].requestVerification(writeDeletion.phone),
      privacy[0].fulfilDeletion(owner, writeDeletion.requestId, resolution),
    ]);
    rejectDatabaseErrors(writeOverlap);
    check(
      writeOverlap.every((result) => result.status === 'fulfilled'),
      'deletion-new-challenge-overlap',
    );
    await assertDeleted(writeDeletion);
    // A challenge issued after deletion may support a fresh identity, never the closed card.
    const written = writeOverlap[0];
    if (written.status === 'fulfilled') {
      const pending = await first.query('SELECT id FROM verification_challenges WHERE id=$1', [
        written.value.challengeId,
      ]);
      if (pending.rows.length) {
        assert(written.value.developmentCode, 'synthetic-verification');
        const verified = await customers[1].verifyCode(
          written.value.challengeId,
          written.value.developmentCode,
        );
        check(verified.customerId !== writeDeletion.customerId, 'fresh-identity-after-deletion');
        const access = await Promise.allSettled([
          customers[1].getCard(verified.customerId, writeDeletion.memberId),
        ]);
        rejectDatabaseErrors(access);
        check(access[0].status === 'rejected', 'fresh-identity-closed-card-isolation');
      }
    }
    onStage('deletion-preferences-fixture');
    const preferencesDeletion = await deletionFixture(4);
    onStage('deletion-preferences-overlap');
    const preferenceOverlap = await Promise.allSettled([
      customers[1].updatePreferences(preferencesDeletion.customerId, preferencesDeletion.memberId, {
        sms: true,
        whatsapp: false,
      }),
      customers[1].requestDeletion(preferencesDeletion.customerId, preferencesDeletion.memberId),
      privacy[0].fulfilDeletion(owner, preferencesDeletion.requestId, resolution),
    ]);
    rejectDatabaseErrors(preferenceOverlap);
    check(preferenceOverlap[2].status === 'fulfilled', 'deletion-preferences-overlap');
    await assertDeleted(preferencesDeletion);
    return checks;
  } finally {
    for (const [setting, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[setting];
      else process.env[setting] = value;
    }
  }
}

function schemaUrl(location: string, schema: string) {
  const url = new URL(location);
  url.searchParams.set(
    'options',
    `-c search_path=${schema} -c statement_timeout=30000 -c lock_timeout=15000`,
  );
  return url.toString();
}

async function main() {
  let admin: Database | undefined;
  const scoped: Database[] = [];
  const owned = new Set<string>();
  let result: { status: string; checks: number; tables: number; rows: number } | undefined;
  let failure: string | undefined;
  let stage: DrillStage = 'configuration';
  let failedStage: DrillStage | undefined;
  let failedSqlState: string | undefined;
  let phaseStarted = performance.now();
  const advanceStage = (next: DrillStage) => {
    process.stdout.write(
      JSON.stringify({
        status: 'drill-stage',
        stage,
        durationMs: Math.round(performance.now() - phaseStarted),
      }) + '\n',
    );
    stage = next;
    phaseStarted = performance.now();
  };
  try {
    const args = process.argv.slice(2);
    assert(
      args.length === 0 || (args.length === 1 && args[0] === '--wallet-only'),
      'drill-arguments',
    );
    const walletOnly = args[0] === '--wallet-only';
    assert(process.env.NQTA_ALLOW_DISPOSABLE_SCHEMA === 'true', 'disposable-schema-flag-required');
    const location = process.env.DATABASE_URL || '';
    const key = process.env.BACKUP_ENCRYPTION_KEY || '';
    const url = new URL(location);
    assert(
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.hostname &&
        url.pathname.length > 1 &&
        url.searchParams.getAll('sslmode').length === 1 &&
        ['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') || ''),
      'tls-postgres-required',
    );
    const bytes = Buffer.from(key, 'base64');
    const validKey = bytes.length === 32 && bytes.toString('base64') === key;
    bytes.fill(0);
    assert(validKey, 'backup-key-required');
    stage = 'schema-create';
    admin = await createDatabase(location);
    const names = [0, 1].map(() => `nqta_check_${randomUUID().replaceAll('-', '')}`);
    for (const name of names) {
      assert(/^nqta_check_[a-f0-9]{32}$/.test(name), 'owned-schema-name');
      await admin.query(`CREATE SCHEMA "${name}"`);
      // A schema is owned only after this CREATE succeeds. No IF NOT EXISTS is used.
      owned.add(name);
    }
    stage = 'pool-open';
    for (const name of [names[0], names[0], names[1]])
      scoped.push(await createDatabase(schemaUrl(location, name)));
    const [first, second, restore] = scoped;
    stage = 'migrate';
    const migrationTimings: {
      pool: number;
      status: 'passed' | 'failed';
      durationMs: number;
      sqlState?: string;
    }[] = [];
    const migrationResults = await Promise.allSettled(
      [first, second].map(async (db, index) => {
        const started = performance.now();
        try {
          const migrationDatabase: Database = {
            ...db,
            transaction: (operation) =>
              db.transaction(async (tx) => {
                // Measured cold schema DDL held the advisory lock for 21.58s.
                // SET LOCAL extends only this migration; runtime pool locks stay at 15s.
                await tx.query("SET LOCAL lock_timeout = '60s'");
                return operation(tx);
              }),
          };
          await migrate(migrationDatabase);
          migrationTimings[index] = {
            pool: index + 1,
            status: 'passed',
            durationMs: Math.round(performance.now() - started),
          };
        } catch (error) {
          const state = sqlState(error);
          migrationTimings[index] = {
            pool: index + 1,
            status: 'failed',
            durationMs: Math.round(performance.now() - started),
            ...(state ? { sqlState: state } : {}),
          };
          throw error;
        }
      }),
    );
    // Wait for both operations, including a winning cold migration, before cleanup.
    // Only fixed pool indices, status, duration and validated SQLSTATE are printed.
    process.stdout.write(
      JSON.stringify({ status: 'migration-timings', migrations: migrationTimings }) + '\n',
    );
    const failedMigration = migrationResults.find((item) => item.status === 'rejected');
    if (failedMigration?.status === 'rejected') throw failedMigration.reason;
    if (walletOnly) {
      advanceStage('wallet');
      const wallet = await exerciseWalletConcurrency(first, second);
      advanceStage('snapshot');
      const snapshot = await createEncryptedBackup(first, key);
      advanceStage('restore');
      const restored = await restoreEncryptedBackup(restore, snapshot.data, key);
      assert(
        restored.tables === snapshot.tables && restored.rows === snapshot.rows,
        'wallet-restore-counts',
      );
      advanceStage('restore-wallet');
      const restoredChecks = await verifyWalletRestore(restore, wallet.state);
      result = {
        status: 'passed',
        checks: wallet.checks + restoredChecks + 1,
        tables: snapshot.tables,
        rows: snapshot.rows,
      };
    } else {
      let checks = await exerciseDatabaseConcurrency(first, second, (value) => {
        advanceStage(value);
      });
      advanceStage('key-auth');
      const keyAuth = await exerciseKeyAuthConcurrency(first, second);
      checks += keyAuth.checks;
      advanceStage('wallet');
      const wallet = await exerciseWalletConcurrency(first, second);
      checks += wallet.checks;
      advanceStage('snapshot');
      const snapshot = await createEncryptedBackup(first, key);
      advanceStage('restore');
      const restored = await restoreEncryptedBackup(restore, snapshot.data, key);
      assert(
        restored.tables === snapshot.tables && restored.rows === snapshot.rows,
        'restore-counts',
      );
      advanceStage('restore-table-counts');
      const tableNames = (
        await first.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name",
        )
      ).rows;
      for (const { table_name } of tableNames) {
        assert(/^[a-z_][a-z0-9_]*$/.test(table_name), 'application-table-name');
        assert(
          (await count(first, `SELECT COUNT(*) FROM "${table_name}"`)) ===
            (await count(restore, `SELECT COUNT(*) FROM "${table_name}"`)),
          'restore-table-count',
        );
      }
      advanceStage('restore-idempotency');
      const originalEvent = (
        await first.query<{ id: string }>(
          "SELECT id FROM events WHERE shop_id='drill-shop' AND receipt_reference='drill-duplicate'",
        )
      ).rows[0].id;
      const beforeEvents = await count(restore, 'SELECT COUNT(*) FROM events');
      const replay = await createLoyaltyService(restore).recordPurchase(
        { userId: 'drill-owner', shopId: 'drill-shop', role: 'owner' },
        {
          membershipId: (
            await restore.query<{ id: string }>(
              "SELECT id FROM memberships WHERE customer_id='drill-customer' AND shop_id='drill-shop'",
            )
          ).rows[0].id,
          qualifies: true,
          amountMinor: 2500,
          receiptReference: 'drill-duplicate',
          idempotencyKey: 'drill-duplicate',
        },
      );
      assert(
        replay.eventId === originalEvent &&
          (await count(restore, 'SELECT COUNT(*) FROM events')) === beforeEvents,
        'restored-idempotency',
      );
      advanceStage('restore-consents');
      const beforeSequence = (
        await restore.query<{ maximum: string }>('SELECT MAX(sequence) AS maximum FROM consents')
      ).rows[0].maximum;
      const restoredMember = (
        await restore.query<{ id: string }>(
          "SELECT id FROM memberships WHERE customer_id='drill-customer' AND shop_id='drill-shop'",
        )
      ).rows[0].id;
      const restoredCard = await createLoyaltyService(restore).getMembership(
        { userId: 'drill-owner', shopId: 'drill-shop', role: 'owner' },
        restoredMember,
      );
      assert(
        restoredCard.totalStamps === 4 &&
          restoredCard.needsReview &&
          restoredCard.rewards[0].state === 'redeemed',
        'restored-ledger-integrity',
      );
      await createCustomerService(restore, { development: true }).updatePreferences(
        'drill-customer',
        restoredMember,
        { sms: false, whatsapp: true },
      );
      assert(
        BigInt(
          (
            await restore.query<{ maximum: string }>(
              'SELECT MAX(sequence) AS maximum FROM consents',
            )
          ).rows[0].maximum,
        ) > BigInt(beforeSequence),
        'restored-consent-sequence',
      );
      advanceStage('restore-key-auth');
      checks += await verifyKeyAuthRestore(restore, keyAuth.state);
      advanceStage('restore-wallet');
      checks += await verifyWalletRestore(restore, wallet.state);
      result = {
        status: 'passed',
        checks: checks + 4 + tableNames.length,
        tables: snapshot.tables,
        rows: snapshot.rows,
      };
    }
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        status: 'drill-stage',
        stage,
        durationMs: Math.round(performance.now() - phaseStarted),
      }) + '\n',
    );
    failedStage = stage;
    failedSqlState = sqlState(error);
    failure =
      error instanceof DrillError ||
      error instanceof BackupError ||
      error instanceof DrillKeyError ||
      error instanceof DrillWalletError
        ? error.code
        : 'database-drill-failed';
  } finally {
    stage = 'cleanup';
    const closed = await Promise.allSettled(scoped.map((db) => db.close()));
    if (closed.some((item) => item.status === 'rejected')) failure ||= 'pool-cleanup-failed';
    if (admin) {
      for (const schema of owned) {
        // Cleanup never uses configuration or user input as a schema identifier.
        if (!/^nqta_check_[a-f0-9]{32}$/.test(schema)) {
          failure ||= 'owned-schema-name';
          continue;
        }
        try {
          await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        } catch {
          failure ||= 'schema-cleanup-failed';
        }
      }
      try {
        await admin.close();
      } catch {
        failure ||= 'pool-cleanup-failed';
      }
    }
  }
  if (failure) {
    process.stderr.write(
      JSON.stringify({
        status: 'failed',
        code: failure,
        stage: failedStage || stage,
        ...(failedSqlState ? { sqlState: failedSqlState } : {}),
      }) + '\n',
    );
    process.exitCode = 1;
  } else process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1]?.endsWith('/scripts/check-postgres.ts')) void main();
