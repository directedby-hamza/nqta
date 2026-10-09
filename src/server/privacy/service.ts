import type { Database } from '../db/client';
import type { Actor } from '../loyalty/types';
import { assertActor } from '../auth/permissions';
import { id } from '../auth/crypto';
import { auditEvent } from '../audit';
import { lockCustomerIdentity } from '../auth/identity-lock';
import { enqueueMembershipWalletUpdates } from '../wallet/store';

export async function assertMerchantPrivacy(db: Database, shopId: string) {
  const shop = (
    await db.query<{ privacy_notice: string; privacy_contact: string }>(
      'SELECT privacy_notice,privacy_contact FROM shops WHERE id=$1',
      [shopId],
    )
  ).rows[0];
  if (!shop?.privacy_notice.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shop.privacy_contact))
    throw new Error(
      'Add your customer privacy notice and contact email in Settings before publishing or enrolling customers.',
    );
}

export function createPrivacyService(db: Database) {
  return {
    async fulfilDeletion(actor: Actor, requestId: string, resolution: string) {
      if (resolution.trim().length < 10 || resolution.length > 2000)
        throw new Error('Explain the deletion decision in 10–2000 characters.');
      await db.transaction(async (tx) => {
        await assertActor(tx, actor, true, true);
        const request = (
          await tx.query<{ membership_id: string; status: string }>(
            "SELECT membership_id,status FROM support_requests WHERE id=$1 AND shop_id=$2 AND kind='deletion'",
            [requestId, actor.shopId],
          )
        ).rows[0];
        if (!request) throw new Error('Request not found or access denied.');
        if (request.status === 'resolved') return;
        const existing = (
          await tx.query<{
            customer_id: string;
            phone: string | null;
            contact_email: string | null;
          }>(
            'SELECT m.customer_id,c.phone,m.contact_email FROM memberships m JOIN customers c ON c.id=m.customer_id WHERE m.id=$1 AND m.shop_id=$2',
            [request.membership_id, actor.shopId],
          )
        ).rows[0];
        if (!existing) throw new Error('Membership not found or access denied.');
        // Match reward-code creation's reward → customer order. Phone verification also shares
        // the identity lock; password authentication shares the customer row lock.
        await tx.query('SELECT id FROM rewards WHERE membership_id=$1 ORDER BY id FOR UPDATE', [
          request.membership_id,
        ]);
        if (existing.phone) await lockCustomerIdentity(tx, existing.phone);
        await tx.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [existing.customer_id]);
        await tx.query('SELECT id FROM memberships WHERE id=$1 FOR UPDATE', [
          request.membership_id,
        ]);
        // Preserve the shop-level withdrawal if another active card shares this address.
        // The deleted card's raw email is cleared below; no suppression contact is retained.
        if (existing.contact_email) {
          const matches = await tx.query<{ id: string }>(
            "SELECT id FROM memberships WHERE shop_id=$1 AND status='active' AND id<>$2 AND LOWER(TRIM(contact_email))=LOWER(TRIM($3::text)) ORDER BY id",
            [actor.shopId, request.membership_id, existing.contact_email],
          );
          for (const match of matches.rows)
            await tx.query(
              "INSERT INTO consents(id,membership_id,channel,opted_in,wording_version) VALUES($1,$2,'email',false,'email-newsletter-deletion-1.0')",
              [id(), match.id],
            );
        }
        const removedId = id();
        await tx.query("INSERT INTO customers(id,phone,name) VALUES($1,$2,'Removed member')", [
          removedId,
          `removed:${removedId}`,
        ]);
        await tx.query(
          "UPDATE memberships SET customer_id=$1,status='closed',member_code=$2,contact_phone=NULL,contact_email=NULL WHERE id=$3",
          [removedId, `CLOSED-${id()}`, request.membership_id],
        );
        await tx.query(
          "UPDATE rewards SET state='revoked' WHERE membership_id=$1 AND state='available'",
          [request.membership_id],
        );
        await tx.query(
          'DELETE FROM redemption_challenges WHERE reward_id IN(SELECT id FROM rewards WHERE membership_id=$1)',
          [request.membership_id],
        );
        for (const channel of ['sms', 'whatsapp'])
          await tx.query(
            'INSERT INTO consents(id,membership_id,channel,opted_in) VALUES($1,$2,$3,false)',
            [id(), request.membership_id, channel],
          );
        await tx.query(
          "INSERT INTO consents(id,membership_id,channel,opted_in,wording_version) VALUES($1,$2,'email',false,'email-newsletter-1.0')",
          [id(), request.membership_id],
        );
        await tx.query('UPDATE audit SET actor_id=$1 WHERE shop_id=$2 AND actor_id=$3', [
          removedId,
          actor.shopId,
          existing.customer_id,
        ]);
        await tx.query(
          "UPDATE support_requests SET status='resolved',resolution=$1,resolved_at=NOW() WHERE shop_id=$2 AND membership_id=$3 AND kind='deletion' AND status='open'",
          [resolution.trim(), actor.shopId, request.membership_id],
        );
        const others = await tx.query('SELECT id FROM memberships WHERE customer_id=$1', [
          existing.customer_id,
        ]);
        if (!others.rows.length) {
          const person = (
            await tx.query<{ phone: string | null }>('SELECT phone FROM customers WHERE id=$1', [
              existing.customer_id,
            ])
          ).rows[0];
          await tx.query("DELETE FROM sessions WHERE kind='customer' AND principal_id=$1", [
            existing.customer_id,
          ]);
          await tx.query('DELETE FROM redemption_challenges WHERE customer_id=$1', [
            existing.customer_id,
          ]);
          if (person?.phone) {
            await tx.query('DELETE FROM verification_challenges WHERE phone=$1', [person.phone]);
            await tx.query('DELETE FROM verification_limits WHERE phone=$1', [person.phone]);
          }
          await tx.query('DELETE FROM customer_credentials WHERE customer_id=$1', [
            existing.customer_id,
          ]);
          await tx.query('DELETE FROM customers WHERE id=$1', [existing.customer_id]);
        }
        await auditEvent(
          tx,
          actor.shopId,
          actor.userId,
          'deletion.fulfilled',
          request.membership_id,
          resolution.trim(),
        );
        await enqueueMembershipWalletUpdates(tx, request.membership_id);
      });
    },
    async resolveRequest(actor: Actor, requestId: string, resolution: string) {
      if (resolution.trim().length < 10 || resolution.length > 2000)
        throw new Error('Explain the resolution in 10–2000 characters.');
      await db.transaction(async (tx) => {
        await assertActor(tx, actor, true, true);
        const request = (
          await tx.query<{ kind: string; status: string }>(
            'SELECT kind,status FROM support_requests WHERE id=$1 AND shop_id=$2 FOR UPDATE',
            [requestId, actor.shopId],
          )
        ).rows[0];
        if (!request) throw new Error('Request not found or access denied.');
        if (request.kind === 'deletion')
          throw new Error('Use the deletion action to remove this member’s identity.');
        if (request.status === 'resolved') return;
        await tx.query(
          "UPDATE support_requests SET status='resolved',resolution=$1,resolved_at=NOW() WHERE id=$2",
          [resolution.trim(), requestId],
        );
        await auditEvent(
          tx,
          actor.shopId,
          actor.userId,
          'support.resolved',
          requestId,
          resolution.trim(),
        );
      });
    },
  };
}
