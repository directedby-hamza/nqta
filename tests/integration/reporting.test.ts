import { afterEach, beforeEach, expect, it } from 'vitest';
import { createReportingService } from '../../src/server/reporting/metrics';
import { fixture, owner, cashier, otherOwner } from './fixture';
import type { Database } from '../../src/server/db/client';
let db: Database;
let reporting: ReturnType<typeof createReportingService>;
const range = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' };
beforeEach(async () => {
  db = await fixture();
  reporting = createReportingService(db);
  await db.query(
    "INSERT INTO customers(id,phone,name) VALUES('c1','+212600000001','Mina'),('c2','+212600000002','Sara')",
  );
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES('m1','shop','programme','c1','NQ-ONE'),('m2','shop','programme','c2','NQ-TWO')",
  );
  for (const [id, member, amount, at] of [
    ['e1', 'm1', 2500, '2026-10-05T10:00:00Z'],
    ['e2', 'm1', null, '2026-10-05T12:00:00Z'],
    ['e3', 'm2', 4000, '2026-10-06T12:00:00Z'],
  ] as const) {
    await db.query(
      "INSERT INTO events(id,shop_id,membership_id,programme_id,staff_id,kind,qualifies,amount_minor,created_at) VALUES($1,'shop',$2,'programme','owner','purchase',true,$3,$4)",
      [id, member, amount, at],
    );
  }
});
afterEach(async () => {
  await db?.close();
});
it('distinguishes paid receipts from recorded visit days and handles missing amounts', async () => {
  const data = await reporting.getDashboard(owner, range);
  expect(data.paidPurchases).toBe(3);
  expect(data.visitDays).toBe(2);
  expect(data.activeMembers).toBe(2);
  expect(data.repeatShare).toBe(50);
  expect(data.recordedSpendingMinor).toBe(6500);
  expect(data.amountCoverage).toBeCloseTo(66.666, 1);
});
it('excludes reversed receipts from spending and purchase counts', async () => {
  await db.query("UPDATE events SET reversed=true WHERE id='e1'");
  const data = await reporting.getDashboard(owner, range);
  expect(data.paidPurchases).toBe(2);
  expect(data.recordedSpendingMinor).toBe(4000);
  expect(data.amountCoverage).toBe(50);
});
it('handles empty ranges without NaN or misleading spending', async () => {
  const data = await reporting.getDashboard(owner, { from: '2020-01-01', to: '2020-02-01' });
  expect(data.paidPurchases).toBe(0);
  expect(data.repeatShare).toBe(0);
  expect(data.amountCoverage).toBe(0);
});
it('reports only the authenticated shop and enforces owner-only exports', async () => {
  expect((await reporting.getDashboard(otherOwner, range)).paidPurchases).toBe(0);
  await expect(reporting.exportActivity(cashier, range)).rejects.toThrow(/owner/i);
  const csv = await reporting.exportActivity(owner, range);
  expect(csv).toContain('amount_minor');
  expect(csv).not.toContain('+212600000001');
});
it('uses end-exclusive date ranges', async () => {
  expect(
    (
      await reporting.getDashboard(owner, {
        from: '2026-10-05T00:00:00Z',
        to: '2026-10-06T00:00:00Z',
      })
    ).paidPurchases,
  ).toBe(2);
});
