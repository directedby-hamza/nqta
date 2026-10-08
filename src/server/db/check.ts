import type { Database } from './client';

export async function checkForDemoData(db: Database): Promise<void> {
  const { rows } = await db.query(`
    SELECT 1 FROM shops WHERE id='shop-morrow'
    UNION ALL SELECT 1 FROM staff WHERE id IN ('demo-owner','demo-cashier') OR lower(email) LIKE '%@nqta.demo'
    UNION ALL SELECT 1 FROM customers WHERE id LIKE 'demo-customer-%'
    UNION ALL SELECT 1 FROM programmes WHERE id='programme-morrow'
    UNION ALL SELECT 1 FROM memberships WHERE id LIKE 'demo-member-%' OR member_code LIKE 'NQ-DEMO%'
    LIMIT 1
  `);
  if (rows.length)
    throw new Error(
      'Production startup rejected synthetic demo records. Use a separate production database and retain this database for testing.',
    );
}
