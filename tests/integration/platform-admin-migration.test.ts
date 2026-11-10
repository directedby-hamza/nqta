import { expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/client';
import { migrate, migrations } from '../../src/server/db/migrate';

it('upgrades version six in place, preserves old rows and leaves every existing shop unreviewed', async () => {
  const db = await createDatabase();
  try {
    await migrate(db, migrations.slice(0, 6));
    await db.query(
      "INSERT INTO shops(id,slug,name) VALUES('existing-shop','existing','Existing shop')",
    );
    await db.query(
      "INSERT INTO customers(id,phone,name) VALUES('existing-customer','+212600999333','Existing customer')",
    );
    const shops = (await db.query('SELECT * FROM shops')).rows;
    const customers = (await db.query('SELECT * FROM customers')).rows;
    const history = (await db.query('SELECT * FROM nqta_schema_migrations ORDER BY version')).rows;
    await migrate(db);
    await migrate(db);
    expect((await db.query('SELECT * FROM shops')).rows).toEqual(shops);
    expect((await db.query('SELECT * FROM customers')).rows).toEqual(customers);
    expect(
      (await db.query('SELECT * FROM nqta_schema_migrations WHERE version<=6 ORDER BY version'))
        .rows,
    ).toEqual(history);
    expect(
      (await db.query('SELECT shop_id,state,valid_until,revision FROM shop_billing')).rows,
    ).toEqual([{ shop_id: 'existing-shop', state: 'unreviewed', valid_until: null, revision: 0 }]);
    expect((await db.query('SELECT * FROM platform_payments')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM platform_admins')).rows).toHaveLength(0);
  } finally {
    await db.close();
  }
});
