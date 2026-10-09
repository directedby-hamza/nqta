import type { Database } from '../db/client';

export function createCustomerAccessService(db: Database) {
  return {
    async lookup(customerId: string, shopSlug: string): Promise<{ membershipId: string | null }> {
      // Recover earned cards independently of the shop's current enrolment programme.
      // This read never creates a membership or changes consent for a new shop.
      const { rows } = await db.query<{ id: string }>(
        `SELECT m.id FROM memberships m JOIN shops s ON s.id=m.shop_id
        WHERE m.customer_id=$1 AND s.slug=$2 AND m.status='active'
        ORDER BY m.created_at DESC,m.id DESC LIMIT 1`,
        [customerId, shopSlug],
      );
      return { membershipId: rows[0]?.id ?? null };
    },
  };
}
