import { expect, it } from 'vitest';
import { assertActor } from '../../src/server/auth/permissions';
import type { Database } from '../../src/server/db/client';

it('rejects an actor revoked while their operation waited for the shop lock', async () => {
  let active = true;
  const db: Database = {
    query: async <T>(sql: string) => {
      // Simulate a revocation committing just before this waiter obtains the lock.
      if (sql.includes('FROM shops')) {
        active = false;
        return { rows: [{ id: 'shop' }] as T[] };
      }
      return { rows: (active ? [{ role: 'cashier', name: 'Sara' }] : []) as T[] };
    },
    transaction: async (operation) => operation(db),
    close: async () => {},
  };
  await expect(
    assertActor(db, { userId: 'cashier', shopId: 'shop', role: 'cashier' }, false, true),
  ).rejects.toThrow(/access/i);
});
