import { timingSafeEqual } from 'node:crypto';
import type { Database } from '../db/client';
import { productionMode } from '../environment';
import { auditEvent } from '../audit';
import { hashPassword, hashToken, token } from './crypto';
import { reserveLimit } from './rate-limit';

const invalidCredentials = () => new Error('The recovery credentials are incorrect.');

export function createStaffKeyRecoveryService(db: Database) {
  return {
    async resetPassword(
      email: string,
      recoveryKey: string,
      password: string,
    ): Promise<{ recoveryKey: string }> {
      const normalised = email.trim().toLowerCase();
      await reserveLimit(db, {
        scope: 'staff-key-recovery-email',
        key: normalised,
        limit: 5,
        windowSeconds: 900,
      });
      await reserveLimit(db, {
        scope: 'staff-key-recovery-global',
        key: 'all',
        limit: 1000,
        windowSeconds: 86400,
      });
      if (
        normalised.length > 200 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised) ||
        !/^[a-f0-9]{64}$/.test(recoveryKey)
      )
        throw invalidCredentials();
      return db.transaction(async (tx) => {
        const candidate = (
          await tx.query<{ id: string; shop_id: string }>(
            "SELECT id,shop_id FROM staff WHERE email=$1 AND auth_method='recovery-key'",
            [normalised],
          )
        ).rows[0];
        if (!candidate) throw invalidCredentials();
        const shop = (
          await tx.query<{ status: string }>('SELECT status FROM shops WHERE id=$1 FOR UPDATE', [
            candidate.shop_id,
          ])
        ).rows[0];
        const staff = (
          await tx.query<{
            id: string;
            active: boolean;
            auth_method: string;
            recovery_key_hash: string | null;
            email: string;
          }>(
            'SELECT id,active,auth_method,recovery_key_hash,email FROM staff WHERE id=$1 FOR UPDATE',
            [candidate.id],
          )
        ).rows[0];
        if (
          !shop ||
          shop.status !== 'active' ||
          !staff?.active ||
          staff.auth_method !== 'recovery-key' ||
          !staff.recovery_key_hash ||
          (productionMode() && staff.email.endsWith('@nqta.demo'))
        )
          throw invalidCredentials();
        const expected = Buffer.from(staff.recovery_key_hash, 'hex');
        const presented = Buffer.from(hashToken(recoveryKey), 'hex');
        if (expected.length !== presented.length || !timingSafeEqual(expected, presented))
          throw invalidCredentials();
        const passwordHash = await hashPassword(password);
        const replacementKey = token();
        await tx.query('UPDATE staff SET password_hash=$1,recovery_key_hash=$2 WHERE id=$3', [
          passwordHash,
          hashToken(replacementKey),
          staff.id,
        ]);
        await tx.query("DELETE FROM sessions WHERE principal_id=$1 AND kind='staff'", [staff.id]);
        await tx.query('DELETE FROM login_limits WHERE email=$1', [staff.email]);
        await tx.query('DELETE FROM login_attempts WHERE email=$1', [staff.email]);
        await auditEvent(tx, candidate.shop_id, staff.id, 'staff.password.reset', staff.id);
        return { recoveryKey: replacementKey };
      });
    },
  };
}
