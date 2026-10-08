import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, getDatabase, type Database } from '../../src/server/db/client';
import { migrate, migrations, type Migration } from '../../src/server/db/migrate';
import * as migrationModule from '../../src/server/db/migrate';
import { checkForDemoData } from '../../src/server/db/check';

let db: Database;
const globalDb = globalThis as unknown as { nqtaDatabase?: Promise<Database> };

beforeEach(async () => {
  db = await createDatabase();
});
afterEach(async () => {
  await db?.close();
  if (globalDb.nqtaDatabase) {
    await globalDb.nqtaDatabase.then((database) => database.close()).catch(() => {});
    delete globalDb.nqtaDatabase;
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function hasTable(name: string) {
  return (
    (await db.query('SELECT table_name FROM information_schema.tables WHERE table_name=$1', [name]))
      .rows.length > 0
  );
}

describe('versioned database migrations', () => {
  it('records each applied version and skips it on a later startup', async () => {
    await migrate(db);
    expect(await hasTable('nqta_schema_migrations')).toBe(true);
    const before = await db.query(
      'SELECT version,name,checksum,applied_at FROM nqta_schema_migrations ORDER BY version',
    );
    expect(before.rows).toHaveLength(5);
    await migrate(db);
    expect(
      (
        await db.query(
          'SELECT version,name,checksum,applied_at FROM nqta_schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual(before.rows);
  });

  it('adopts the previous schema without losing merchant or ledger records', async () => {
    await migrate(db, [migrations[0]]);
    await db.query('DROP TABLE IF EXISTS nqta_schema_migrations');
    await db.query(
      "INSERT INTO shops(id,slug,name) VALUES('merchant','merchant','Existing merchant')",
    );
    await db.query(
      "INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES('owner','merchant','Owner','owner@example.com','stored-hash','owner')",
    );
    await db.query(
      "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('programme','merchant',5,'Coffee','Paid receipt','published')",
    );
    await db.query(
      "INSERT INTO customers(id,phone,name) VALUES('customer','+212600001001','Existing customer')",
    );
    await db.query(
      "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('member','merchant','programme','customer','NQ-EXISTING')",
    );
    await db.query(
      "INSERT INTO events(id,shop_id,membership_id,programme_id,staff_id,kind,qualifies) VALUES('purchase','merchant','member','programme','owner','purchase',true)",
    );
    await db.query(
      "INSERT INTO ledger(id,membership_id,event_id,delta) VALUES('entry','member','purchase',1)",
    );
    await db.query(
      "INSERT INTO actions(shop_id,action_key,fingerprint,result) VALUES('merchant','existing-action','existing-fingerprint','{\"eventId\":\"purchase\"}')",
    );
    await db.query(
      "INSERT INTO consents(id,membership_id,channel,opted_in) VALUES('consent','member','sms',false)",
    );
    await migrate(db);
    expect(
      Number(
        (await db.query<{ balance: string | number }>('SELECT SUM(delta) AS balance FROM ledger'))
          .rows[0].balance,
      ),
    ).toBe(1);
    expect((await db.query('SELECT result FROM actions')).rows).toEqual([
      { result: { eventId: 'purchase' } },
    ]);
    expect((await db.query('SELECT phone,name FROM customers')).rows).toEqual([
      { phone: '+212600001001', name: 'Existing customer' },
    ]);
    expect((await db.query('SELECT opted_in FROM consents')).rows).toEqual([{ opted_in: false }]);
    expect(await hasTable('nqta_schema_migrations')).toBe(true);
  });

  it('adds production verification, request-limit and privacy fields to existing tables', async () => {
    await migrate(db);
    expect(await hasTable('staff_email_tokens')).toBe(true);
    expect(await hasTable('request_limits')).toBe(true);
    const columns = (
      await db.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name IN ('staff','shops','support_requests')",
      )
    ).rows.map((row) => row.column_name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'email_verified',
        'privacy_notice',
        'privacy_contact',
        'resolved_at',
        'resolution',
      ]),
    );
    await db.query("INSERT INTO shops(id,slug,name) VALUES('merchant','merchant','Merchant')");
    await db.query(
      "INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES('owner','merchant','Owner','owner@example.com','stored-hash','owner')",
    );
    expect((await db.query('SELECT email_verified FROM staff')).rows).toEqual([
      { email_verified: false },
    ]);
    await expect(
      db.query(
        "INSERT INTO staff_email_tokens(id,staff_id,token_hash,kind,expires_at) VALUES('token','owner','hash','unsupported',NOW())",
      ),
    ).rejects.toThrow();
  });

  it('upgrades existing accounts without converting their authentication method and permits phone-free credentials', async () => {
    await migrate(db, migrations.slice(0, 2));
    await db.query("INSERT INTO shops(id,slug,name) VALUES('merchant','merchant','Merchant')");
    await db.query(
      "INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES('owner','merchant','Owner','owner@example.com','stored-hash','owner')",
    );
    await db.query("INSERT INTO customers(id,phone) VALUES('existing','+212600001001')");
    await migrate(db);
    expect((await db.query('SELECT phone FROM customers')).rows).toEqual([
      { phone: '+212600001001' },
    ]);
    expect(
      (await db.query('SELECT auth_method,email_verified,recovery_key_hash FROM staff')).rows,
    ).toEqual([
      { auth_method: 'verified-contact', email_verified: false, recovery_key_hash: null },
    ]);
    await db.query("INSERT INTO customers(id) VALUES('key-one'),('key-two')");
    await db.query(
      "INSERT INTO customer_credentials(customer_id,account_id,password_hash,recovery_key_hash) VALUES('key-one','NA-ONE','password-hash','key-hash')",
    );
    await expect(
      db.query(
        "INSERT INTO customer_credentials(customer_id,account_id,password_hash,recovery_key_hash) VALUES('key-two','NA-TWO','other-password','key-hash')",
      ),
    ).rejects.toThrow();
    await expect(
      db.query("UPDATE staff SET auth_method='unsupported' WHERE id='owner'"),
    ).rejects.toThrow();
  });

  it('adds optional shop-specific contacts without changing existing identity or membership data', async () => {
    await migrate(db, migrations.slice(0, 4));
    await db.query("INSERT INTO shops(id,slug,name) VALUES('merchant','merchant','Merchant')");
    await db.query(
      "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('programme','merchant',5,'Coffee','Paid receipt','published')",
    );
    await db.query(
      "INSERT INTO customers(id,phone,name) VALUES('customer','+212600001001','Mina')",
    );
    await db.query(
      "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('member','merchant','programme','customer','NQ-EXISTING')",
    );
    const before = (
      await db.query('SELECT version,name,checksum FROM nqta_schema_migrations ORDER BY version')
    ).rows;
    await migrate(db);
    const member = (
      await db.query<{ member: Record<string, unknown> }>(
        'SELECT to_jsonb(m) AS member FROM memberships m',
      )
    ).rows[0].member;
    expect(member).toMatchObject({
      id: 'member',
      customer_id: 'customer',
      member_code: 'NQ-EXISTING',
      status: 'active',
      contact_phone: null,
      contact_email: null,
    });
    expect((await db.query('SELECT phone,name FROM customers')).rows).toEqual([
      { phone: '+212600001001', name: 'Mina' },
    ]);
    expect(
      (
        await db.query(
          'SELECT version,name,checksum FROM nqta_schema_migrations WHERE version<=4 ORDER BY version',
        )
      ).rows,
    ).toEqual(before);
  });

  it('rolls back all schema changes when a later migration statement fails', async () => {
    const plan: Migration[] = [
      {
        version: 1,
        name: 'broken_upgrade',
        statements: [
          'CREATE TABLE migration_probe(id text PRIMARY KEY)',
          'INSERT INTO missing_migration_table VALUES(1)',
        ],
      },
    ];
    await expect(migrate(db, plan)).rejects.toThrow();
    expect(await hasTable('migration_probe')).toBe(false);
    expect(await hasTable('nqta_schema_migrations')).toBe(false);
    expect(await hasTable('shops')).toBe(false);
  });

  it('applies a later version without running an already applied data change twice', async () => {
    const first: Migration = {
      version: 1,
      name: 'first',
      statements: [
        'CREATE TABLE migration_probe(value integer NOT NULL)',
        'INSERT INTO migration_probe(value) VALUES(7)',
      ],
    };
    await migrate(db, [first]);
    await migrate(db, [
      first,
      {
        version: 2,
        name: 'second',
        statements: [
          'ALTER TABLE migration_probe ADD COLUMN label text',
          "UPDATE migration_probe SET label='upgraded'",
        ],
      },
    ]);
    expect((await db.query('SELECT value,label FROM migration_probe')).rows).toEqual([
      { value: 7, label: 'upgraded' },
    ]);
    expect(
      (await db.query('SELECT version FROM nqta_schema_migrations ORDER BY version')).rows,
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it('rejects changing an applied migration rather than silently rewriting history', async () => {
    const first: Migration = {
      version: 1,
      name: 'first',
      statements: [
        'CREATE TABLE migration_probe(value integer NOT NULL)',
        'INSERT INTO migration_probe(value) VALUES(7)',
      ],
    };
    await migrate(db, [first]);
    await expect(
      migrate(db, [
        {
          ...first,
          statements: [
            'CREATE TABLE migration_probe(value integer NOT NULL)',
            'INSERT INTO migration_probe(value) VALUES(9)',
          ],
        },
      ]),
    ).rejects.toThrow(/checksum|changed/i);
    expect((await db.query('SELECT value FROM migration_probe')).rows).toEqual([{ value: 7 }]);
  });

  it('recognizes the same migration regardless of object property order', async () => {
    const first: Migration = {
      name: 'first',
      version: 1,
      statements: [
        'CREATE TABLE migration_probe(value integer NOT NULL)',
        'INSERT INTO migration_probe(value) VALUES(7)',
      ],
    };
    await migrate(db, [first]);
    await expect(
      migrate(db, [{ version: 1, name: 'first', statements: first.statements }]),
    ).resolves.toBeUndefined();
    expect((await db.query('SELECT value FROM migration_probe')).rows).toEqual([{ value: 7 }]);
  });

  it('rejects a database newer than the application migration plan', async () => {
    const first: Migration = {
      version: 1,
      name: 'first',
      statements: ['CREATE TABLE migration_probe(value integer NOT NULL)'],
    };
    const second: Migration = {
      version: 2,
      name: 'second',
      statements: ['INSERT INTO migration_probe(value) VALUES(7)'],
    };
    await migrate(db, [first, second]);
    await expect(migrate(db, [first])).rejects.toThrow(/newer|unknown|unsupported/i);
    expect((await db.query('SELECT value FROM migration_probe')).rows).toEqual([{ value: 7 }]);
  });

  it('serializes concurrent local initializations into one applied history', async () => {
    await Promise.all([migrate(db), migrate(db), migrate(db)]);
    expect(await hasTable('nqta_schema_migrations')).toBe(true);
    expect(
      (await db.query('SELECT version FROM nqta_schema_migrations ORDER BY version')).rows,
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
  });

  it('takes the PostgreSQL transaction lock before any migration DDL', async () => {
    let locked = false;
    const postgresBoundary: Database = {
      ...db,
      dialect: 'postgres',
      transaction: (operation) =>
        db.transaction((tx) =>
          operation({
            ...tx,
            dialect: 'postgres',
            query: async <T>(sql: string, values?: unknown[]) => {
              if (sql.includes('pg_advisory_xact_lock')) {
                locked = true;
                return { rows: [] as T[] };
              }
              if (/^\s*(CREATE|ALTER)/i.test(sql) && !locked)
                throw new Error('Migration DDL ran without the transaction lock.');
              return tx.query<T>(sql, values);
            },
          }),
        ),
    };
    await migrate(postgresBoundary);
    expect(locked).toBe(true);
    expect(await hasTable('shops')).toBe(true);
  });
});

it('rejects invalid production configuration before creating a local data directory', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nqta-startup-'));
  const location = path.join(directory, 'must-not-open');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('DEMO_MODE', 'false');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('DATA_DIRECTORY', location);
  try {
    await expect(getDatabase().then(() => undefined)).rejects.toThrow(
      /production|database|postgres/i,
    );
    const { access } = await import('node:fs/promises');
    await expect(access(location)).rejects.toThrow();
  } finally {
    if (globalDb.nqtaDatabase) {
      await globalDb.nqtaDatabase.then((database) => database.close()).catch(() => {});
      delete globalDb.nqtaDatabase;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

describe('production data checks', () => {
  it('accepts an empty or independently created merchant database', async () => {
    await migrate(db);
    await db.query("INSERT INTO shops(id,slug,name) VALUES('merchant','morrow','Morrow')");
    await db.query(
      "INSERT INTO customers(id,phone,name) VALUES('customer','+212600000001','Customer')",
    );
    await expect(checkForDemoData(db)).resolves.toBeUndefined();
  });

  it.each([
    ['shop', "INSERT INTO shops(id,slug,name) VALUES('shop-morrow','morrow','Morrow')"],
    [
      'customer',
      "INSERT INTO customers(id,phone,name) VALUES('demo-customer-0','+212600000001','Customer')",
    ],
    [
      'staff',
      "INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES('owner','merchant','Owner','owner@nqta.demo','unused','owner')",
    ],
    [
      'programme',
      "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility) VALUES('programme-morrow','merchant',5,'Coffee','Paid receipt')",
    ],
    [
      'membership',
      "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('member','merchant','programme','customer','NQ-DEMO0001')",
    ],
  ])('rejects surviving synthetic %s markers without deleting any data', async (_kind, insert) => {
    await migrate(db);
    await db.query("INSERT INTO shops(id,slug,name) VALUES('merchant','merchant','Merchant')");
    await db.query(
      "INSERT INTO customers(id,phone,name) VALUES('customer','+212600001001','Customer')",
    );
    await db.query(
      "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility) VALUES('programme','merchant',5,'Coffee','Paid receipt')",
    );
    await db.query(insert);
    const before = (await db.query('SELECT COUNT(*) AS count FROM shops')).rows;
    await expect(checkForDemoData(db)).rejects.toThrow(/synthetic|demo/i);
    expect((await db.query('SELECT COUNT(*) AS count FROM shops')).rows).toEqual(before);
  });
});

it('closes a database after failed initialization and retries a later startup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nqta-failed-startup-'));
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('DEMO_MODE', 'false');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('DATA_DIRECTORY', directory);
  const originalMigrate = migrationModule.migrate;
  let failedDatabase: Database | undefined;
  vi.spyOn(migrationModule, 'migrate').mockImplementationOnce(async (database) => {
    failedDatabase = database;
    await originalMigrate(database);
    throw new Error('Injected initialization failure.');
  });
  try {
    await expect(getDatabase().then(() => undefined)).rejects.toThrow(
      'Injected initialization failure.',
    );
    await expect(failedDatabase!.query('SELECT 1')).rejects.toThrow(/closed/i);
    const retried = await getDatabase();
    expect(
      (
        await retried.query(
          "SELECT table_name FROM information_schema.tables WHERE table_name='shops'",
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    if (globalDb.nqtaDatabase) {
      await globalDb.nqtaDatabase.then((database) => database.close()).catch(() => {});
      delete globalDb.nqtaDatabase;
    }
    await failedDatabase?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
