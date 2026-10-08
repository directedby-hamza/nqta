import type { Database } from '../db/client';
import type {
  Actor,
  MembershipCard,
  PurchaseInput,
  PurchaseResult,
  RedemptionInput,
  RedemptionResult,
  ReversalInput,
  ReversalResult,
} from './types';
import { assertActor } from '../auth/permissions';
import { hashCode, hashToken, id } from '../auth/crypto';
import { readMembership } from './membership';
import { OperationRejectedError } from './errors';
import { enqueueMembershipWalletUpdates } from '../wallet/store';

async function audit(db: Database, actor: Actor, action: string, target: string, reason?: string) {
  await db.query(
    'INSERT INTO audit(id,shop_id,actor_id,action,target_id,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [id(), actor.shopId, actor.userId, action, target, reason || null],
  );
}
export function createLoyaltyService(db: Database) {
  async function mutation<T>(
    actor: Actor,
    key: string,
    operation: string,
    input: unknown,
    run: (tx: Database) => Promise<T | { rejected: string }>,
    ownerOnly = false,
  ): Promise<T> {
    if (!key || key.length > 128)
      throw new OperationRejectedError('A valid action identifier is required.');
    const fingerprint = hashToken(JSON.stringify({ actor: actor.userId, operation, input }));
    const outcome = await db.transaction(async (tx) => {
      await assertActor(tx, actor, ownerOnly, true);
      const previous = await tx.query<{ fingerprint: string; result: T }>(
        'SELECT fingerprint,result FROM actions WHERE shop_id=$1 AND action_key=$2',
        [actor.shopId, key],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].fingerprint !== fingerprint)
          throw new Error(
            'This action identifier was used for different input. Resolve the original confirmation before creating another.',
          );
        return previous.rows[0].result;
      }
      const result = await run(tx);
      if (result && typeof result === 'object' && 'rejected' in result) return result;
      await tx.query(
        'INSERT INTO actions(shop_id,action_key,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)',
        [actor.shopId, key, fingerprint, JSON.stringify(result)],
      );
      return result;
    });
    if (outcome && typeof outcome === 'object' && 'rejected' in outcome)
      throw new OperationRejectedError(String(outcome.rejected));
    return outcome as T;
  }
  return {
    async getMembership(actor: Actor, membershipId: string): Promise<MembershipCard> {
      await assertActor(db, actor);
      return readMembership(db, membershipId, { shopId: actor.shopId });
    },
    async recordPurchase(actor: Actor, input: PurchaseInput): Promise<PurchaseResult> {
      if (
        input.amountMinor != null &&
        (!Number.isSafeInteger(input.amountMinor) ||
          input.amountMinor < 0 ||
          input.amountMinor > 100000000)
      )
        throw new OperationRejectedError('Enter a valid purchase amount.');
      if (input.qualifies && input.amountMinor === 0)
        throw new OperationRejectedError('A qualifying paid purchase must have a positive amount.');
      const normalised = {
        membershipId: input.membershipId,
        qualifies: input.qualifies,
        amountMinor: input.amountMinor ?? null,
        receiptReference: input.receiptReference?.trim() || null,
      };
      return mutation(actor, input.idempotencyKey, 'purchase', normalised, async (tx) => {
        const card = await readMembership(tx, input.membershipId, { shopId: actor.shopId });
        const shop = await tx.query<{ status: string }>('SELECT status FROM shops WHERE id=$1', [
          actor.shopId,
        ]);
        if (shop.rows[0].status !== 'active')
          throw new OperationRejectedError('This shop is paused. New earning is unavailable.');
        if (card.status !== 'active')
          throw new OperationRejectedError('This membership is inactive.');
        if (normalised.receiptReference) {
          const used = await tx.query(
            'SELECT id FROM events WHERE shop_id=$1 AND receipt_reference=$2 AND kind=$3',
            [actor.shopId, normalised.receiptReference, 'purchase'],
          );
          if (used.rows.length)
            throw new OperationRejectedError('This receipt has already been recorded.');
        }
        const eventId = id();
        await tx.query(
          'INSERT INTO events(id,shop_id,membership_id,programme_id,staff_id,kind,qualifies,amount_minor,receipt_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            eventId,
            actor.shopId,
            card.id,
            card.programmeId,
            actor.userId,
            'purchase',
            input.qualifies,
            normalised.amountMinor,
            normalised.receiptReference,
          ],
        );
        await tx.query('INSERT INTO ledger(id,membership_id,event_id,delta) VALUES($1,$2,$3,$4)', [
          id(),
          card.id,
          eventId,
          input.qualifies ? 1 : 0,
        ]);
        const totalStamps = card.totalStamps + (input.qualifies ? 1 : 0);
        const entitlements = Math.floor(totalStamps / card.threshold);
        for (let sequence = 1; sequence <= entitlements; sequence++) {
          await tx.query(
            `INSERT INTO rewards(id,shop_id,membership_id,programme_id,sequence,description) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(membership_id,sequence) DO UPDATE SET state='available' WHERE rewards.state='revoked'`,
            [id(), actor.shopId, card.id, card.programmeId, sequence, card.rewardDescription],
          );
        }
        await audit(tx, actor, 'purchase.recorded', eventId);
        await enqueueMembershipWalletUpdates(tx, card.id);
        const current = await readMembership(tx, card.id, { shopId: actor.shopId });
        const newlyIssuedRewardId = current.rewards.find(
          (reward) =>
            reward.state === 'available' &&
            !card.rewards.some((before) => before.id === reward.id && before.state === 'available'),
        )?.id;
        return {
          eventId,
          progress: current.progress,
          totalStamps: current.totalStamps,
          availableRewards: current.rewards.filter((r) => r.state === 'available').length,
          ...(newlyIssuedRewardId ? { newlyIssuedRewardId } : {}),
        };
      });
    },
    async redeemReward(actor: Actor, input: RedemptionInput): Promise<RedemptionResult> {
      return mutation<RedemptionResult>(
        actor,
        input.idempotencyKey,
        'redemption',
        { rewardId: input.rewardId, challengeId: input.challengeId || null, code: input.code },
        async (tx) => {
          const { rows } = await tx.query<{
            id: string;
            membership_id: string;
            programme_id: string;
            state: string;
          }>('SELECT * FROM rewards WHERE id=$1 AND shop_id=$2 FOR UPDATE', [
            input.rewardId,
            actor.shopId,
          ]);
          const reward = rows[0];
          if (!reward) throw new OperationRejectedError('Reward not found or shop access denied.');
          if (reward.state !== 'available')
            throw new OperationRejectedError('This reward has already been redeemed or revoked.');
          const card = await readMembership(tx, reward.membership_id, { shopId: actor.shopId });
          if (card.status !== 'active')
            throw new OperationRejectedError('This membership is inactive.');
          const challenges = await tx.query<{
            id: string;
            code_hash: string;
            expires_at: Date;
            used: boolean;
            attempts: number;
          }>(
            `SELECT ch.* FROM redemption_challenges ch JOIN memberships m ON m.customer_id=ch.customer_id AND m.id=$3
          WHERE ch.reward_id=$1 AND ($2::text IS NULL OR ch.id=$2) ORDER BY ch.created_at DESC LIMIT 1 FOR UPDATE OF ch`,
            [reward.id, input.challengeId || null, reward.membership_id],
          );
          const challenge = challenges.rows[0];
          if (
            !challenge ||
            challenge.used ||
            new Date(challenge.expires_at).getTime() <= Date.now()
          )
            throw new OperationRejectedError(
              'The customer confirmation code is expired or unavailable.',
            );
          if (challenge.attempts >= 5)
            return { rejected: 'Too many confirmation attempts. Ask the customer for a new code.' };
          if (
            !/^\d{6}$/.test(input.code) ||
            challenge.code_hash !== hashCode(challenge.id, input.code)
          ) {
            await tx.query('UPDATE redemption_challenges SET attempts=attempts+1 WHERE id=$1', [
              challenge.id,
            ]);
            return { rejected: 'The customer confirmation code is incorrect.' };
          }
          const eventId = id();
          await tx.query(
            "INSERT INTO events(id,shop_id,membership_id,programme_id,staff_id,kind) VALUES($1,$2,$3,$4,$5,'redemption')",
            [eventId, actor.shopId, reward.membership_id, reward.programme_id, actor.userId],
          );
          await tx.query(
            "UPDATE rewards SET state='redeemed',redeemed_at=NOW(),redemption_event_id=$1 WHERE id=$2",
            [eventId, reward.id],
          );
          await tx.query('UPDATE redemption_challenges SET used=true WHERE id=$1', [challenge.id]);
          await audit(tx, actor, 'reward.redeemed', reward.id);
          await enqueueMembershipWalletUpdates(tx, reward.membership_id);
          return { eventId, rewardId: reward.id, state: 'redeemed' };
        },
      );
    },
    async reversePurchase(actor: Actor, input: ReversalInput): Promise<ReversalResult> {
      if (!input.reason?.trim() || input.reason.length > 500)
        throw new OperationRejectedError('A correction reason is required.');
      return mutation(
        actor,
        input.idempotencyKey,
        'reversal',
        { eventId: input.eventId, reason: input.reason.trim() },
        async (tx) => {
          const { rows } = await tx.query<{
            id: string;
            membership_id: string;
            programme_id: string;
            qualifies: boolean;
            reversed: boolean;
          }>("SELECT * FROM events WHERE id=$1 AND shop_id=$2 AND kind='purchase' FOR UPDATE", [
            input.eventId,
            actor.shopId,
          ]);
          const purchase = rows[0];
          if (!purchase) throw new OperationRejectedError('Purchase not found or access denied.');
          if (purchase.reversed) {
            const card = await readMembership(tx, purchase.membership_id, { shopId: actor.shopId });
            return { eventId: purchase.id, needsReview: card.needsReview };
          }
          const eventId = id();
          await tx.query(
            "INSERT INTO events(id,shop_id,membership_id,programme_id,staff_id,kind,original_event_id,reason) VALUES($1,$2,$3,$4,$5,'reversal',$6,$7)",
            [
              eventId,
              actor.shopId,
              purchase.membership_id,
              purchase.programme_id,
              actor.userId,
              purchase.id,
              input.reason.trim(),
            ],
          );
          await tx.query('UPDATE events SET reversed=true WHERE id=$1', [purchase.id]);
          await tx.query(
            'INSERT INTO ledger(id,membership_id,event_id,delta) VALUES($1,$2,$3,$4)',
            [id(), purchase.membership_id, eventId, purchase.qualifies ? -1 : 0],
          );
          const card = await readMembership(tx, purchase.membership_id, { shopId: actor.shopId });
          const entitlement = Math.floor(card.totalStamps / card.threshold);
          await tx.query(
            "UPDATE rewards SET state='revoked' WHERE membership_id=$1 AND sequence>$2 AND state='available'",
            [card.id, entitlement],
          );
          const used = await tx.query(
            "SELECT id FROM rewards WHERE membership_id=$1 AND sequence>$2 AND state='redeemed'",
            [card.id, entitlement],
          );
          const needsReview = used.rows.length > 0;
          if (needsReview)
            await tx.query(
              "INSERT INTO support_requests(id,shop_id,membership_id,kind,message) VALUES($1,$2,$3,'reconciliation',$4)",
              [
                id(),
                actor.shopId,
                card.id,
                `Refund ${purchase.id} affects a reward already redeemed. Owner review required; no customer charge has been applied.`,
              ],
            );
          await audit(tx, actor, 'purchase.reversed', purchase.id, input.reason.trim());
          await enqueueMembershipWalletUpdates(tx, purchase.membership_id);
          return { eventId, needsReview };
        },
        true,
      );
    },
  };
}
