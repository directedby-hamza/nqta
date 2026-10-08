import type { Database } from '../db/client';
import { id } from '../auth/crypto';
import { readMembership } from '../loyalty/membership';
import type { WalletCard, WalletPass, WalletProvider } from './contracts';

type PassRow = {
  id: string;
  membership_id: string;
  provider: WalletProvider;
  external_id: string;
  revision: string;
  synced_revision: string;
  lock_token: string | null;
  updated_at: Date | string;
};
const passColumns = `p.id,p.membership_id,p.provider,p.external_id,p.revision::text AS revision,
 p.synced_revision::text AS synced_revision,p.lock_token,p.updated_at`;
const nextRevision = `nextval(pg_get_serial_sequence('wallet_passes','revision'))`;

function passFromRow(row: PassRow): WalletPass {
  return {
    id: row.id,
    membershipId: row.membership_id,
    provider: row.provider,
    externalId: row.external_id,
    revision: row.revision,
    syncedRevision: row.synced_revision,
    ...(row.lock_token ? { lockToken: row.lock_token } : {}),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// NEXTVAL alone can commit out of order. Serialize allocations until commit so a
// device's watermark cannot skip a lower, still uncommitted revision. Acquire this
// lock before locking Wallet rows; no provider network request runs in this store.
async function lockRevisionAllocator(tx: Database) {
  if (tx.dialect === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(1852929121, 4)');
}

async function enqueue(tx: Database, condition: string, targetId: string) {
  const present = await tx.query(`SELECT p.id FROM wallet_passes p WHERE ${condition} LIMIT 1`, [
    targetId,
  ]);
  if (!present.rows.length) return;
  await lockRevisionAllocator(tx);
  await tx.query(
    `UPDATE wallet_passes p SET revision=${nextRevision},updated_at=NOW(),
    retry_at=NOW(),attempts=0 WHERE ${condition}`,
    [targetId],
  );
}

export async function enqueueMembershipWalletUpdates(
  tx: Database,
  membershipId: string,
): Promise<void> {
  // Share issuance's membership lock even when there is no pass yet: otherwise an
  // uncommitted first issuance can miss this transaction's newly saved card state.
  await tx.query('SELECT id FROM memberships WHERE id=$1 FOR UPDATE', [membershipId]);
  await enqueue(tx, 'p.membership_id=$1', membershipId);
}

export async function enqueueShopWalletUpdates(tx: Database, shopId: string): Promise<void> {
  await tx.query('SELECT id FROM memberships WHERE shop_id=$1 ORDER BY id FOR UPDATE', [shopId]);
  await enqueue(tx, 'p.membership_id IN (SELECT id FROM memberships WHERE shop_id=$1)', shopId);
}

function validRevision(revision: string) {
  return /^\d{1,19}$/.test(revision) && BigInt(revision) <= 9223372036854775807n;
}

export function createWalletStore(db: Database) {
  async function cardForPass(tx: Database, row: PassRow): Promise<WalletCard> {
    const scope = (
      await tx.query<{ shop_id: string }>('SELECT shop_id FROM memberships WHERE id=$1', [
        row.membership_id,
      ])
    ).rows[0];
    const card = await readMembership(tx, row.membership_id, { shopId: scope.shop_id });
    if (card.status !== 'active') {
      card.name = 'Removed member';
      delete card.phone;
    }
    return { pass: passFromRow(row), card };
  }

  return {
    async getOrCreatePass(
      customerId: string,
      membershipId: string,
      provider: WalletProvider,
      externalId: string,
    ): Promise<WalletCard> {
      if (!['apple', 'google'].includes(provider) || !externalId || externalId.length > 256)
        throw new Error('Invalid Wallet provider configuration.');
      return db.transaction(async (tx) => {
        const scope = (
          await tx.query<{ shop_id: string }>(
            'SELECT shop_id FROM memberships WHERE id=$1 AND customer_id=$2',
            [membershipId, customerId],
          )
        ).rows[0];
        if (!scope) throw new Error('Membership not found or access denied.');
        // Preferences and owner mutations lock the shop before membership/customer
        // rows. Serialize with those operations before locking the shared identity.
        await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [scope.shop_id]);
        await tx.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [customerId]);
        const member = (
          await tx.query<{ status: string }>(
            'SELECT status FROM memberships WHERE id=$1 AND customer_id=$2 FOR UPDATE',
            [membershipId, customerId],
          )
        ).rows[0];
        if (!member) throw new Error('Membership not found or access denied.');
        if (member.status !== 'active') throw new Error('This membership is inactive.');
        await lockRevisionAllocator(tx);
        let row = (
          await tx.query<PassRow>(
            `SELECT ${passColumns} FROM wallet_passes p WHERE p.membership_id=$1 AND p.provider=$2`,
            [membershipId, provider],
          )
        ).rows[0];
        if (row && row.external_id !== externalId)
          throw new Error('The saved Wallet pass uses a different issuer configuration.');
        if (!row) {
          row = (
            await tx.query<PassRow>(
              `INSERT INTO wallet_passes AS p(id,membership_id,provider,external_id) VALUES($1,$2,$3,$4)
             RETURNING ${passColumns}`,
              [id(), membershipId, provider, externalId],
            )
          ).rows[0];
        }
        return cardForPass(tx, row);
      });
    },

    async getPassBySerial(provider: WalletProvider, serial: string): Promise<WalletCard | null> {
      return db.transaction(async (tx) => {
        const row = (
          await tx.query<PassRow>(
            `SELECT ${passColumns} FROM wallet_passes p WHERE p.id=$1 AND p.provider=$2`,
            [serial, provider],
          )
        ).rows[0];
        return row ? cardForPass(tx, row) : null;
      });
    },

    async claimPendingPasses(
      options: {
        passId?: string;
        membershipId?: string;
        limit?: number;
        providers?: WalletProvider[];
      } = {},
    ): Promise<WalletPass[]> {
      const limit = options.limit ?? 10;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        throw new Error('Wallet claim limit must be an integer from 1 to 20.');
      if (
        options.providers !== undefined &&
        (!Array.isArray(options.providers) ||
          options.providers.some((provider) => !['apple', 'google'].includes(provider)))
      )
        throw new Error('Invalid Wallet claim provider.');
      if (options.providers?.length === 0) return [];
      return db.transaction(async (tx) => {
        const { rows } = await tx.query<PassRow>(
          `WITH pending AS (
          SELECT id FROM wallet_passes WHERE revision>synced_revision AND retry_at<=NOW()
          AND (lease_until IS NULL OR lease_until<=NOW())
          AND ($1::text IS NULL OR id=$1) AND ($2::text IS NULL OR membership_id=$2)
          AND ($5::text[] IS NULL OR provider=ANY($5::text[]))
          ORDER BY revision LIMIT $3 FOR UPDATE SKIP LOCKED)
          UPDATE wallet_passes p SET lock_token=$4,lease_until=NOW()+interval '60 seconds',locked_revision=p.revision
          FROM pending WHERE p.id=pending.id RETURNING ${passColumns}`,
          [
            options.passId ?? null,
            options.membershipId ?? null,
            limit,
            id(),
            options.providers ?? null,
          ],
        );
        return rows.map(passFromRow);
      });
    },

    async markSynced(pass: WalletPass): Promise<void> {
      if (!pass.lockToken || !validRevision(pass.revision)) return;
      await db.query(
        `UPDATE wallet_passes SET synced_revision=GREATEST(synced_revision,$3::bigint),
        lock_token=NULL,lease_until=NULL,locked_revision=NULL,attempts=0,retry_at=NOW()
        WHERE id=$1 AND lock_token=$2 AND lease_until>NOW() AND locked_revision=$3::bigint`,
        [pass.id, pass.lockToken, pass.revision],
      );
    },

    async markFailed(pass: WalletPass): Promise<void> {
      if (!pass.lockToken || !validRevision(pass.revision)) return;
      await db.query(
        `UPDATE wallet_passes SET
        retry_at=CASE WHEN revision>$3::bigint THEN NOW()
          ELSE NOW()+LEAST(3600,5*power(2,LEAST(attempts,10))) * interval '1 second' END,
        attempts=CASE WHEN revision>$3::bigint THEN 0 ELSE LEAST(attempts+1,20) END,
        lock_token=NULL,lease_until=NULL,locked_revision=NULL
        WHERE id=$1 AND lock_token=$2 AND lease_until>NOW() AND locked_revision=$3::bigint`,
        [pass.id, pass.lockToken, pass.revision],
      );
    },

    async registerAppleDevice(
      passId: string,
      deviceId: string,
      pushToken: string,
    ): Promise<{ created: boolean }> {
      if (!deviceId || deviceId.length > 256 || !/^[a-fA-F0-9]{1,200}$/.test(pushToken))
        throw new Error('Invalid Apple device registration.');
      return db.transaction(async (tx) => {
        await lockRevisionAllocator(tx);
        const pass = (
          await tx.query(
            "SELECT id FROM wallet_passes WHERE id=$1 AND provider='apple' FOR UPDATE",
            [passId],
          )
        ).rows[0];
        if (!pass) throw new Error('Apple Wallet pass not found.');
        // Keep unregister/removal from deleting the row between lookup and upsert.
        const existing = (
          await tx.query<{ push_token: string }>(
            'SELECT push_token FROM wallet_devices WHERE pass_id=$1 AND device_id=$2 FOR UPDATE',
            [passId, deviceId],
          )
        ).rows[0];
        if (!existing) {
          const count = (
            await tx.query<{ count: string }>(
              'SELECT COUNT(*)::text AS count FROM wallet_devices WHERE pass_id=$1',
              [passId],
            )
          ).rows[0];
          if (Number(count.count) >= 64)
            throw new Error('Apple device registration limit reached.');
        }
        await tx.query(
          `INSERT INTO wallet_devices(pass_id,device_id,push_token) VALUES($1,$2,$3)
          ON CONFLICT(pass_id,device_id) DO UPDATE SET push_token=EXCLUDED.push_token`,
          [passId, deviceId, pushToken],
        );
        // New registrations and rotated tokens must survive acknowledgement of
        // a delivery that captured the previous device/token set.
        if (!existing || existing.push_token !== pushToken)
          await tx.query(
            `UPDATE wallet_passes SET revision=${nextRevision},updated_at=NOW(),retry_at=NOW(),attempts=0 WHERE id=$1`,
            [passId],
          );
        return { created: !existing };
      });
    },

    async unregisterAppleDevice(passId: string, deviceId: string): Promise<void> {
      await db.query(
        `DELETE FROM wallet_devices d USING wallet_passes p
        WHERE d.pass_id=p.id AND p.provider='apple' AND d.pass_id=$1 AND d.device_id=$2`,
        [passId, deviceId],
      );
    },

    async listAppleSerials(
      deviceId: string,
      passTypeId: string,
      since?: string,
    ): Promise<{ serialNumbers: string[]; lastUpdated: string } | null> {
      if (since !== undefined && !validRevision(since)) throw new Error('Invalid Wallet revision.');
      const { rows } = await db.query<{ id: string; revision: string }>(
        `SELECT p.id,p.revision::text AS revision FROM wallet_passes p JOIN wallet_devices d ON d.pass_id=p.id
         WHERE d.device_id=$1 AND p.provider='apple' AND p.external_id=$2 ORDER BY p.revision`,
        [deviceId, passTypeId],
      );
      const updated = rows.filter((row) => BigInt(row.revision) > BigInt(since ?? '0'));
      if (!updated.length) return null;
      return { serialNumbers: updated.map((row) => row.id), lastUpdated: rows.at(-1)!.revision };
    },

    async getAppleDevices(passId: string): Promise<{ deviceId: string; pushToken: string }[]> {
      const { rows } = await db.query<{ device_id: string; push_token: string }>(
        `SELECT d.device_id,d.push_token FROM wallet_devices d JOIN wallet_passes p ON p.id=d.pass_id
         WHERE p.id=$1 AND p.provider='apple' ORDER BY d.device_id`,
        [passId],
      );
      return rows.map((row) => ({ deviceId: row.device_id, pushToken: row.push_token }));
    },

    async removeAppleDevice(passId: string, deviceId: string, pushToken: string): Promise<void> {
      await db.query(
        `DELETE FROM wallet_devices d USING wallet_passes p
        WHERE d.pass_id=p.id AND p.provider='apple' AND d.pass_id=$1 AND d.device_id=$2 AND d.push_token=$3`,
        [passId, deviceId, pushToken],
      );
    },
  };
}
