import { PGlite } from '@electric-sql/pglite';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import * as schema from './schema';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { assertHostedTestConfiguration, demoMode, hostedTestMode } from '../environment';

export interface Database {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(operation: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  orm?: unknown;
}
export async function createDatabase(location?: string): Promise<Database> {
  if (location?.startsWith('postgres')) {
    const pool = new Pool({ connectionString: location });
    const wrap = (connection: Pool | PoolClient): Database => ({
      query: async <T>(sql: string, values: unknown[] = []) => ({
        rows: (await connection.query(sql, values)).rows as T[],
      }),
      transaction: async <T>(operation: (db: Database) => Promise<T>) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await operation(wrap(client));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      close: async () => {
        await pool.end();
      },
      orm: pgDrizzle(pool, { schema }),
    });
    return wrap(pool);
  }
  if (location) await mkdir(location, { recursive: true });
  const client = new PGlite(location);
  await client.waitReady;
  const db: Database = {
    query: async <T>(sql: string, values: unknown[] = []) => ({
      rows: (await client.query(sql, values)).rows as T[],
    }),
    transaction: async (operation) =>
      client.transaction(async (tx) =>
        operation({
          query: async <T>(sql: string, values: unknown[] = []) => ({
            rows: (await tx.query(sql, values)).rows as T[],
          }),
          transaction: async () => {
            throw new Error('Nested transactions are not supported.');
          },
          close: async () => {},
        }),
      ),
    close: async () => {
      await client.close();
    },
    orm: pgliteDrizzle(client, { schema }),
  };
  return db;
}
const globalDb = globalThis as unknown as { nqtaDatabase?: Promise<Database> };
export function getDatabase(): Promise<Database> {
  if (!globalDb.nqtaDatabase) {
    globalDb.nqtaDatabase = (async () => {
      assertHostedTestConfiguration();
      const location =
        process.env.DATABASE_URL ||
        path.resolve(process.cwd(), process.env.DATA_DIRECTORY || '.data/nqta');
      const db = await createDatabase(location);
      const { migrate } = await import('./migrate');
      await migrate(db);
      if (demoMode() && !hostedTestMode()) {
        const { seedDemo } = await import('./seed');
        await seedDemo(db);
      }
      return db;
    })().catch((error) => {
      delete globalDb.nqtaDatabase;
      throw error;
    });
  }
  return globalDb.nqtaDatabase;
}
