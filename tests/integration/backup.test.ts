import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, type Database } from '../../src/server/db/client';
import { createLoyaltyService } from '../../src/server/loyalty/service';
import { createCustomerService } from '../../src/server/auth/customer';
import { fixture, owner } from './fixture';
import * as backup from '../../src/server/db/backup';
import { migrate } from '../../src/server/db/migrate';

let source: Database;
const targets: Database[] = [];
const key = randomBytes(32).toString('base64');
let lastPurchase: Awaited<ReturnType<ReturnType<typeof createLoyaltyService>['recordPurchase']>>;

beforeAll(async () => {
  source = await fixture();
  await source.query(
    "INSERT INTO customers(id,phone,name) VALUES('customer','+212600009001','Backup fixture')",
  );
  await source.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('member','shop','programme','customer','NQ-BACKUP-FIXTURE')",
  );
  const loyalty = createLoyaltyService(source);
  for (let index = 0; index < 5; index++) {
    lastPurchase = await loyalty.recordPurchase(owner, {
      membershipId: 'member',
      qualifies: true,
      amountMinor: 2500,
      receiptReference: `fixture-${index}`,
      idempotencyKey: `purchase-${index}`,
    });
  }
  const customers = createCustomerService(source, { development: true });
  const card = await customers.getCard('customer', 'member');
  const challenge = await customers.createRedemptionChallenge('customer', card.rewards[0].id);
  await loyalty.redeemReward(owner, {
    rewardId: card.rewards[0].id,
    challengeId: challenge.challengeId,
    code: challenge.code,
    idempotencyKey: 'redemption',
  });
  await loyalty.reversePurchase(owner, {
    eventId: lastPurchase.eventId,
    reason: 'Synthetic refund fixture',
    idempotencyKey: 'reversal',
  });
  await customers.updatePreferences('customer', 'member', { sms: true, whatsapp: false });
  await source.query(
    "INSERT INTO staff_email_tokens(id,staff_id,token_hash,kind,expires_at) VALUES('email-token','owner','synthetic-email-token-hash','reset',NOW()+interval '1 hour')",
  );
  await source.query("INSERT INTO request_limits(bucket,attempts) VALUES('fixture-bucket',3)");
  await source.query(
    "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES('session','synthetic-session-hash','customer','customer',NOW()+interval '1 hour')",
  );
  await source.query(
    "INSERT INTO verification_challenges(id,phone,code_hash,expires_at) VALUES('verification','+212600009001','synthetic-code-hash',NOW()+interval '1 hour')",
  );
  await source.query(
    "INSERT INTO staff_invitations(id,shop_id,name,email,role,token_hash) VALUES('invitation','shop','Fixture','fixture@example.invalid','cashier','synthetic-invite-hash')",
  );
  await source.query(
    "INSERT INTO login_attempts(id,email) VALUES('attempt','fixture@example.invalid')",
  );
  await source.query("INSERT INTO verification_limits(phone) VALUES('+212600009001')");
  await source.query("INSERT INTO login_limits(email) VALUES('fixture@example.invalid')");
});

afterEach(async () => {
  await Promise.all(targets.splice(0).map((db) => db.close()));
});
afterAll(async () => {
  await source?.close();
});

async function emptyTarget() {
  const db = await createDatabase();
  targets.push(db);
  return db;
}

async function tables(db: Database) {
  return (
    await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name",
    )
  ).rows.map((row) => row.table_name);
}

function canonicalRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => JSON.stringify(row)).sort();
}

describe('encrypted database backups', () => {
  it('writes only an encrypted private artifact and refuses to replace an existing file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nqta-backup-'));
    try {
      const encrypted = await backup.createEncryptedBackup(source, key);
      const artifact = path.join(directory, 'snapshot.nqta');
      await backup.writeEncryptedBackupFile(artifact, encrypted.data);
      expect((await stat(artifact)).mode & 0o777).toBe(0o600);
      expect(await readFile(artifact)).toEqual(encrypted.data);
      await expect(
        backup.writeEncryptedBackupFile(artifact, Buffer.from('replacement')),
      ).rejects.toThrow();
      expect(await readFile(artifact)).toEqual(encrypted.data);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('encrypts every table with fresh randomness and restores balances, action history and recovery records', async () => {
    const encrypted = await backup.createEncryptedBackup(source, key);
    const another = await backup.createEncryptedBackup(source, key);
    expect(encrypted.data.equals(another.data)).toBe(false);
    expect(encrypted.data.includes(Buffer.from('+212600009001'))).toBe(false);
    expect(encrypted.data.includes(Buffer.from('synthetic-email-token-hash'))).toBe(false);
    const target = await emptyTarget();
    const restored = await backup.restoreEncryptedBackup(target, encrypted.data, key);
    const names = await tables(source);
    expect(restored).toEqual({ tables: names.length, rows: encrypted.rows });
    expect(await tables(target)).toEqual(names);
    for (const name of names) {
      const originalRows = (await source.query(`SELECT * FROM "${name}"`)).rows;
      const restoredRows = (await target.query(`SELECT * FROM "${name}"`)).rows;
      expect(canonicalRows(restoredRows), name).toEqual(canonicalRows(originalRows));
    }
    const loyalty = createLoyaltyService(target);
    const card = await loyalty.getMembership(owner, 'member');
    expect(card.totalStamps).toBe(4);
    expect(card.needsReview).toBe(true);
    expect(card.rewards[0].state).toBe('redeemed');
    const beforeEvents = (await target.query('SELECT id FROM events')).rows.length;
    expect(
      await loyalty.recordPurchase(owner, {
        membershipId: 'member',
        qualifies: true,
        amountMinor: 2500,
        receiptReference: 'fixture-4',
        idempotencyKey: 'purchase-4',
      }),
    ).toEqual(lastPurchase);
    expect((await target.query('SELECT id FROM events')).rows).toHaveLength(beforeEvents);
    const previousSequence = Number(
      (
        await target.query<{ maximum: string | number }>(
          'SELECT MAX(sequence) AS maximum FROM consents',
        )
      ).rows[0].maximum,
    );
    const customers = createCustomerService(target, { development: true });
    await customers.updatePreferences('customer', 'member', { sms: false, whatsapp: true });
    const nextSequence = Number(
      (
        await target.query<{ maximum: string | number }>(
          'SELECT MAX(sequence) AS maximum FROM consents',
        )
      ).rows[0].maximum,
    );
    expect(nextSequence).toBeGreaterThan(previousSequence);
    expect((await customers.getCard('customer', 'member')).consents).toEqual({
      sms: false,
      whatsapp: true,
    });
  });

  it('rejects damaged ciphertext and a wrong key before changing the target', async () => {
    const encrypted = await backup.createEncryptedBackup(source, key);
    const target = await emptyTarget();
    const damaged = Buffer.from(encrypted.data);
    damaged[damaged.length - 1] ^= 0x80;
    await expect(backup.restoreEncryptedBackup(target, damaged, key)).rejects.toThrow(
      /authentication|encrypted|backup/i,
    );
    await expect(
      backup.restoreEncryptedBackup(target, encrypted.data, randomBytes(32).toString('base64')),
    ).rejects.toThrow(/authentication|encrypted|backup/i);
    expect(await tables(target)).toEqual([]);
  });

  it('requires a full length canonical base64 key', async () => {
    await expect(backup.createEncryptedBackup(source, 'too-short')).rejects.toThrow(/key/i);
    await expect(
      backup.createEncryptedBackup(source, randomBytes(31).toString('base64')),
    ).rejects.toThrow(/key/i);
  });

  it('refuses a target containing existing tables and preserves its rows', async () => {
    const encrypted = await backup.createEncryptedBackup(source, key);
    const target = await emptyTarget();
    await target.query('CREATE TABLE existing_records(value text)');
    await target.query("INSERT INTO existing_records(value) VALUES('keep this record')");
    await expect(backup.restoreEncryptedBackup(target, encrypted.data, key)).rejects.toThrow(
      /empty/i,
    );
    expect((await target.query('SELECT value FROM existing_records')).rows).toEqual([
      { value: 'keep this record' },
    ]);
    expect(await tables(target)).toEqual(['existing_records']);
  });

  it('refuses a target containing a materialized view and preserves its rows', async () => {
    const encrypted = await backup.createEncryptedBackup(source, key);
    const target = await emptyTarget();
    await target.query(
      "CREATE MATERIALIZED VIEW existing_summary AS SELECT 'keep this summary'::text AS value",
    );
    await expect(backup.restoreEncryptedBackup(target, encrypted.data, key)).rejects.toMatchObject({
      code: 'nonempty-target',
    });
    expect((await target.query('SELECT value FROM existing_summary')).rows).toEqual([
      { value: 'keep this summary' },
    ]);
    expect(await tables(target)).toEqual([]);
  });

  it('rolls back schema creation and restored rows if an insert fails', async () => {
    const encrypted = await backup.createEncryptedBackup(source, key);
    const target = await emptyTarget();
    let failedInsert = false;
    const failingTarget: Database = {
      ...target,
      transaction: (operation) =>
        target.transaction((tx) =>
          operation({
            ...tx,
            query: async <T>(sql: string, values?: unknown[]) => {
              if (sql.startsWith('INSERT INTO "ledger"')) {
                failedInsert = true;
                throw new Error('Injected private row failure.');
              }
              return tx.query<T>(sql, values);
            },
          }),
        ),
    };
    await expect(backup.restoreEncryptedBackup(failingTarget, encrypted.data, key)).rejects.toThrow(
      /restore|unchanged/i,
    );
    expect(failedInsert).toBe(true);
    expect(await tables(target)).toEqual([]);
  });

  it('rejects incompatible migration history instead of producing a misleading backup', async () => {
    const original = (
      await source.query<{ checksum: string }>(
        'SELECT checksum FROM nqta_schema_migrations WHERE version=2',
      )
    ).rows[0].checksum;
    await source.query("UPDATE nqta_schema_migrations SET checksum='incompatible' WHERE version=2");
    try {
      await expect(backup.createEncryptedBackup(source, key)).rejects.toThrow(
        /migration|compatible/i,
      );
    } finally {
      await source.query('UPDATE nqta_schema_migrations SET checksum=$1 WHERE version=2', [
        original,
      ]);
    }
  });

  it('rejects schema drift during restore and leaves the target empty', async () => {
    await source.query('ALTER TABLE customers ADD COLUMN unexpected_field text');
    try {
      const encrypted = await backup.createEncryptedBackup(source, key);
      const target = await emptyTarget();
      await expect(backup.restoreEncryptedBackup(target, encrypted.data, key)).rejects.toThrow(
        /schema|compatible/i,
      );
      expect(await tables(target)).toEqual([]);
    } finally {
      await source.query('ALTER TABLE customers DROP COLUMN unexpected_field');
    }
  });

  it('establishes PostgreSQL repeatable-read read-only isolation before the first snapshot read', async () => {
    let isolated = false;
    const postgresBoundary: Database = {
      ...source,
      dialect: 'postgres',
      transaction: (operation) =>
        source.transaction((tx) =>
          operation({
            ...tx,
            dialect: 'postgres',
            query: async <T>(sql: string, values?: unknown[]) => {
              if (sql.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')) {
                isolated = true;
                return { rows: [] as T[] };
              }
              if (!isolated) throw new Error('Snapshot read without repeatable-read isolation.');
              return tx.query<T>(sql, values);
            },
          }),
        ),
    };
    await backup.createEncryptedBackup(postgresBoundary, key);
    expect(isolated).toBe(true);
  });

  it('exercises the disposable drill with real ledger, privacy and verification services', async () => {
    const target = await emptyTarget();
    await migrate(target);
    const drill = await import('../../scripts/check-postgres').catch(() => null);
    expect(drill?.exerciseDatabaseConcurrency).toBeTypeOf('function');
    if (!drill) return;
    expect(await drill.exerciseDatabaseConcurrency(target, target)).toBeGreaterThan(15);
  });
});
