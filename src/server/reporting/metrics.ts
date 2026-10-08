import type { Database } from '../db/client';
import type { Actor } from '../loyalty/types';
import { assertActor } from '../auth/permissions';
import { auditEvent } from '../audit';
import { maskPhone } from '../loyalty/membership';
export type Range = { from: string; to: string };
export type DashboardData = {
  totalMembers: number;
  newMembers: number;
  activeMembers: number;
  paidPurchases: number;
  visitDays: number;
  repeatShare: number;
  rewardsIssued: number;
  rewardsRedeemed: number;
  recordedSpendingMinor: number;
  amountCoverage: number;
  chart: { date: string; purchases: number }[];
};
export function createReportingService(db: Database) {
  function validateRange(range: Range) {
    const from = new Date(range.from).getTime();
    const to = new Date(range.to).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * 86400000)
      throw new Error('Choose a valid date range of up to one year.');
  }
  return {
    async getDashboard(actor: Actor, range: Range): Promise<DashboardData> {
      await assertActor(db, actor);
      validateRange(range);
      const shop = (
        await db.query<{ timezone: string }>('SELECT timezone FROM shops WHERE id=$1', [
          actor.shopId,
        ])
      ).rows[0];
      const params = [actor.shopId, range.from, range.to];
      const events = (
        await db.query<{
          active: string;
          purchases: string;
          visits: string;
          spending: string;
          captured: string;
        }>(
          `SELECT
        COUNT(DISTINCT membership_id) FILTER(WHERE (kind='purchase' AND qualifies AND NOT reversed) OR kind='redemption') AS active,
        COUNT(*) FILTER(WHERE kind='purchase' AND qualifies AND NOT reversed) AS purchases,
        COUNT(DISTINCT (membership_id,(created_at AT TIME ZONE $4)::date)) FILTER(WHERE (kind='purchase' AND qualifies AND NOT reversed) OR kind='redemption') AS visits,
        COALESCE(SUM(amount_minor) FILTER(WHERE kind='purchase' AND qualifies AND NOT reversed),0) AS spending,
        COUNT(amount_minor) FILTER(WHERE kind='purchase' AND qualifies AND NOT reversed) AS captured
        FROM events WHERE shop_id=$1 AND created_at >= $2 AND created_at < $3`,
          [...params, shop.timezone],
        )
      ).rows[0];
      const members = (
        await db.query<{ total: string; joined: string }>(
          'SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE created_at >= $2 AND created_at < $3) AS joined FROM memberships WHERE shop_id=$1',
          params,
        )
      ).rows[0];
      const repeat = (
        await db.query<{ buyers: string; regulars: string }>(
          `SELECT COUNT(*) AS buyers,COUNT(*) FILTER(WHERE purchases>=2) AS regulars FROM
        (SELECT membership_id,COUNT(*) AS purchases FROM events WHERE shop_id=$1 AND created_at >= $2 AND created_at < $3 AND kind='purchase' AND qualifies AND NOT reversed GROUP BY membership_id) counts`,
          params,
        )
      ).rows[0];
      const rewards = (
        await db.query<{ issued: string; redeemed: string }>(
          'SELECT COUNT(*) FILTER(WHERE created_at >= $2 AND created_at < $3) AS issued,COUNT(*) FILTER(WHERE redeemed_at >= $2 AND redeemed_at < $3) AS redeemed FROM rewards WHERE shop_id=$1',
          params,
        )
      ).rows[0];
      const chart = await db.query<{ date: string; purchases: string }>(
        `SELECT to_char(created_at AT TIME ZONE $4,'YYYY-MM-DD') AS date,COUNT(*) AS purchases FROM events
        WHERE shop_id=$1 AND created_at >= $2 AND created_at < $3 AND kind='purchase' AND qualifies AND NOT reversed GROUP BY date ORDER BY date`,
        [...params, shop.timezone],
      );
      const paidPurchases = Number(events.purchases);
      return {
        totalMembers: Number(members.total),
        newMembers: Number(members.joined),
        activeMembers: Number(events.active),
        paidPurchases,
        visitDays: Number(events.visits),
        repeatShare: Number(repeat.buyers)
          ? (Number(repeat.regulars) / Number(repeat.buyers)) * 100
          : 0,
        rewardsIssued: Number(rewards.issued),
        rewardsRedeemed: Number(rewards.redeemed),
        recordedSpendingMinor: Number(events.spending),
        amountCoverage: paidPurchases ? (Number(events.captured) / paidPurchases) * 100 : 0,
        chart: chart.rows.map((r) => ({ date: r.date, purchases: Number(r.purchases) })),
      };
    },
    async exportActivity(actor: Actor, range: Range): Promise<string> {
      await assertActor(db, actor, true);
      validateRange(range);
      const { rows } = await db.query<{
        id: string;
        name: string;
        kind: string;
        amount_minor: number | null;
        reversed: boolean;
        created_at: Date;
      }>(
        `SELECT e.id,c.name,e.kind,e.amount_minor,e.reversed,e.created_at FROM events e
        JOIN memberships m ON m.id=e.membership_id JOIN customers c ON c.id=m.customer_id
        WHERE e.shop_id=$1 AND e.created_at >= $2 AND e.created_at < $3 ORDER BY e.created_at DESC`,
        [actor.shopId, range.from, range.to],
      );
      const cell = (value: unknown) => {
        let text = value == null ? '' : String(value);
        if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
      };
      await auditEvent(
        db,
        actor.shopId,
        actor.userId,
        'activity.exported',
        actor.shopId,
        `${range.from} to ${range.to}`,
      );
      return [
        ['event_id', 'customer_name', 'kind', 'amount_minor', 'reversed', 'created_at'],
        ...rows.map((r) => [
          r.id,
          r.name,
          r.kind,
          r.amount_minor,
          r.reversed,
          new Date(r.created_at).toISOString(),
        ]),
      ]
        .map((row) => row.map(cell).join(','))
        .join('\r\n');
    },
    async listMemberships(actor: Actor, query = '') {
      await assertActor(db, actor);
      const search = query.slice(0, 100).replace(/[\\%_]/g, '\\$&');
      const { rows } = await db.query<{
        id: string;
        name: string;
        phone: string | null;
        member_code: string;
        created_at: Date;
        stamps: string;
        threshold: number;
        available: string;
        visits: string;
        last_visit: Date | null;
      }>(
        `SELECT m.id,c.name,c.phone,m.member_code,m.created_at,p.threshold,
        COALESCE((SELECT SUM(delta) FROM ledger WHERE membership_id=m.id),0) AS stamps,
        (SELECT COUNT(*) FROM rewards WHERE membership_id=m.id AND state='available') AS available,
        (SELECT COUNT(*) FROM events WHERE membership_id=m.id AND kind='purchase' AND qualifies AND NOT reversed) AS visits,
        (SELECT MAX(created_at) FROM events WHERE membership_id=m.id AND NOT reversed AND kind IN ('purchase','redemption')) AS last_visit
        FROM memberships m JOIN customers c ON c.id=m.customer_id JOIN programmes p ON p.id=m.programme_id
        WHERE m.shop_id=$1 AND (c.name ILIKE '%'||$2||'%' OR m.member_code ILIKE '%'||$2||'%') ORDER BY last_visit DESC NULLS LAST,m.created_at DESC LIMIT 500`,
        [actor.shopId, search],
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name || 'A new regular',
        phone: maskPhone(r.phone),
        memberCode: r.member_code,
        totalStamps: Number(r.stamps),
        progress: Number(r.stamps) % r.threshold,
        threshold: r.threshold,
        availableRewards: Number(r.available),
        visits: Number(r.visits),
        joinedAt: new Date(r.created_at).toISOString(),
        lastVisit: r.last_visit ? new Date(r.last_visit).toISOString() : null,
      }));
    },
    async listActivity(actor: Actor, membershipId?: string) {
      await assertActor(db, actor);
      const { rows } = await db.query<{
        id: string;
        membership_id: string;
        name: string;
        member_code: string;
        kind: string;
        amount_minor: number | null;
        qualifies: boolean;
        reversed: boolean;
        reason: string | null;
        created_at: Date;
        staff_name: string;
      }>(
        `SELECT e.*,c.name,m.member_code,st.name AS staff_name FROM events e JOIN memberships m ON m.id=e.membership_id
        JOIN customers c ON c.id=m.customer_id JOIN staff st ON st.id=e.staff_id
        WHERE e.shop_id=$1 AND ($2::text IS NULL OR e.membership_id=$2) ORDER BY e.created_at DESC LIMIT 150`,
        [actor.shopId, membershipId || null],
      );
      return rows.map((r) => ({
        id: r.id,
        membershipId: r.membership_id,
        name: r.name || 'A new regular',
        memberCode: r.member_code,
        kind: r.kind,
        amountMinor: r.amount_minor,
        qualifies: r.qualifies,
        reversed: r.reversed,
        reason: r.reason,
        at: new Date(r.created_at).toISOString(),
        staffName: r.staff_name,
      }));
    },
  };
}
