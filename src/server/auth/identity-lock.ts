import type { Database } from '../db/client';

// Phone verification and identity removal must serialize even when no challenge row exists yet.
// PGlite serializes its transactions; PostgreSQL needs a transaction-scoped identity lock.
export async function lockCustomerIdentity(db: Database, phone: string) {
  if (db.dialect === 'postgres')
    await db.query('SELECT pg_advisory_xact_lock(1852929122, hashtext(current_schema() || $1))', [
      `:${phone}`,
    ]);
}
