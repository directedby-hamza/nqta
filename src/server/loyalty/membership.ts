import type { Database } from '../db/client';
import type { MembershipCard, Reward } from './types';
export function maskPhone(phone: string | null) {
  if (!phone) return '';
  if (phone.startsWith('removed:')) return 'Removed';
  return `${phone.slice(0, 4)} ••• ••${phone.slice(-3)}`;
}
export async function readMembership(
  db: Database,
  membershipId: string,
  scope: { shopId?: string; customerId?: string },
): Promise<MembershipCard> {
  if (!scope.shopId && !scope.customerId) throw new Error('Membership access requires a scope.');
  const { rows } = await db.query<{
    id: string;
    member_code: string;
    name: string;
    phone: string | null;
    shop_id: string;
    shop_name: string;
    shop_status: string;
    slug: string;
    theme: string;
    location: string;
    programme_id: string;
    threshold: number;
    reward_description: string;
    eligibility: string;
    terms: string;
    status: string;
  }>(
    `SELECT m.*,c.name,c.phone,s.name AS shop_name,s.status AS shop_status,s.slug,s.theme,s.location,p.threshold,p.reward_description,p.eligibility,p.terms
    FROM memberships m JOIN customers c ON c.id=m.customer_id JOIN shops s ON s.id=m.shop_id JOIN programmes p ON p.id=m.programme_id
    WHERE m.id=$1 AND ($2::text IS NULL OR m.shop_id=$2) AND ($3::text IS NULL OR m.customer_id=$3)`,
    [membershipId, scope.shopId || null, scope.customerId || null],
  );
  const member = rows[0];
  if (!member) throw new Error('Membership not found or access denied.');
  const stampRows = await db.query<{ count: string }>(
    'SELECT COALESCE(SUM(delta),0) AS count FROM ledger WHERE membership_id=$1',
    [membershipId],
  );
  const totalStamps = Number(stampRows.rows[0].count);
  const rewards = await db.query<{
    id: string;
    description: string;
    state: Reward['state'];
    created_at: Date;
    redeemed_at: Date | null;
  }>('SELECT * FROM rewards WHERE membership_id=$1 ORDER BY created_at DESC', [membershipId]);
  const review = await db.query(
    'SELECT id FROM support_requests WHERE membership_id=$1 AND kind=$2 AND status=$3',
    [membershipId, 'reconciliation', 'open'],
  );
  return {
    id: member.id,
    memberCode: member.member_code,
    name: member.name || 'A new regular',
    phone: maskPhone(member.phone) || undefined,
    shopId: member.shop_id,
    shopName: member.shop_name,
    shopStatus: member.shop_status,
    shopSlug: member.slug,
    theme: member.theme,
    location: member.location,
    programmeId: member.programme_id,
    threshold: member.threshold,
    rewardDescription: member.reward_description,
    eligibility: member.eligibility,
    terms: member.terms,
    status: member.status,
    totalStamps,
    progress: totalStamps % member.threshold,
    needsReview: review.rows.length > 0,
    rewards: rewards.rows.map((r) => ({
      id: r.id,
      description: r.description,
      state: r.state,
      createdAt: new Date(r.created_at).toISOString(),
      redeemedAt: r.redeemed_at ? new Date(r.redeemed_at).toISOString() : undefined,
    })),
  };
}
