import type { Database } from '../db/client';
import type { Actor } from './types';
import { assertActor } from '../auth/permissions';
import { auditEvent } from '../audit';
import { id } from '../auth/crypto';
export type ProgrammeDraft = {
  id?: string;
  threshold: number;
  rewardDescription: string;
  eligibility: string;
  terms: string;
};
export function createProgrammeService(db: Database) {
  return {
    async saveProgrammeDraft(
      actor: Actor,
      input: ProgrammeDraft,
    ): Promise<{ id: string; revision: number }> {
      return db.transaction(async (tx) => {
        await assertActor(tx, actor, true, true);
        if (
          !Number.isInteger(input.threshold) ||
          input.threshold < 1 ||
          input.threshold > 100 ||
          !input.rewardDescription.trim() ||
          !input.eligibility.trim() ||
          !input.terms.trim()
        )
          throw new Error('A threshold, reward, eligibility, and terms are required.');
        if (
          input.rewardDescription.length > 250 ||
          input.eligibility.length > 1000 ||
          input.terms.length > 2000
        )
          throw new Error('Programme text is too long.');
        if (input.id) {
          const existing = (
            await tx.query<{ status: string }>(
              'SELECT status FROM programmes WHERE id=$1 AND shop_id=$2',
              [input.id, actor.shopId],
            )
          ).rows[0];
          if (!existing) throw new Error('Programme not found.');
          if (existing.status !== 'draft')
            throw new Error('Published economic rules are locked to preserve earned value.');
          const saved = await tx.query<{ revision: number }>(
            'UPDATE programmes SET threshold=$1,reward_description=$2,eligibility=$3,terms=$4,revision=revision+1 WHERE id=$5 RETURNING revision',
            [
              input.threshold,
              input.rewardDescription.trim(),
              input.eligibility.trim(),
              input.terms.trim(),
              input.id,
            ],
          );
          await auditEvent(tx, actor.shopId, actor.userId, 'programme.draft.updated', input.id);
          return { id: input.id, revision: saved.rows[0].revision };
        }
        const draftId = id();
        await tx.query(
          "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,terms,status) VALUES($1,$2,$3,$4,$5,$6,'draft')",
          [
            draftId,
            actor.shopId,
            input.threshold,
            input.rewardDescription.trim(),
            input.eligibility.trim(),
            input.terms.trim(),
          ],
        );
        await auditEvent(tx, actor.shopId, actor.userId, 'programme.drafted', draftId);
        return { id: draftId, revision: 1 };
      });
    },
    async publishProgramme(actor: Actor, draftId: string, reviewedRevision: number): Promise<void> {
      await db.transaction(async (tx) => {
        await assertActor(tx, actor, true, true);
        const published = await tx.query(
          "SELECT id FROM programmes WHERE shop_id=$1 AND status='published'",
          [actor.shopId],
        );
        if (published.rows.length)
          throw new Error(
            'A programme is already published. Rule changes require an assisted transition that preserves earned value.',
          );
        const { rows } = await tx.query<{
          reward_description: string;
          eligibility: string;
          terms: string;
          revision: number;
        }>("SELECT * FROM programmes WHERE id=$1 AND shop_id=$2 AND status='draft' FOR UPDATE", [
          draftId,
          actor.shopId,
        ]);
        if (!rows[0] || !rows[0].reward_description || !rows[0].eligibility || !rows[0].terms)
          throw new Error('A complete draft is required.');
        if (rows[0].revision !== reviewedRevision)
          throw new Error(
            'This draft changed after your review. Reload the programme and review the saved rules again.',
          );
        await tx.query("UPDATE programmes SET status='published' WHERE id=$1", [draftId]);
        await auditEvent(tx, actor.shopId, actor.userId, 'programme.published', draftId);
      });
    },
    async pauseShop(actor: Actor, paused: boolean): Promise<void> {
      await db.transaction(async (tx) => {
        await assertActor(tx, actor, true, true);
        await tx.query('UPDATE shops SET status=$1 WHERE id=$2', [
          paused ? 'paused' : 'active',
          actor.shopId,
        ]);
        await auditEvent(
          tx,
          actor.shopId,
          actor.userId,
          paused ? 'shop.paused' : 'shop.resumed',
          actor.shopId,
        );
      });
    },
  };
}
