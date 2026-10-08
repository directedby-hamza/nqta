import type { Database } from '../db/client';
import type { Actor } from '../loyalty/types';
import { hashPassword, hashToken, id, token, verifyPassword } from './crypto';
import { assertActor } from './permissions';
import { auditEvent } from '../audit';
import { productionMode, recoveryKeyMode } from '../environment';
import { DeliveryError } from '../providers/email';
import { createStaffRecoveryService } from './recovery';
import { RateLimitError } from './rate-limit';
export function createAuthService(db: Database) {
  return {
    async signInStaff(email: string, password: string): Promise<string> {
      const normalised = email.trim().toLowerCase();
      const reservation = await db.query<{ attempts: number }>(
        `INSERT INTO login_limits(email) VALUES($1)
         ON CONFLICT(email) DO UPDATE SET
         attempts=CASE WHEN login_limits.window_started<=NOW()-interval '15 minutes' THEN 1 ELSE login_limits.attempts+1 END,
         window_started=CASE WHEN login_limits.window_started<=NOW()-interval '15 minutes' THEN NOW() ELSE login_limits.window_started END
         WHERE login_limits.attempts<10 OR login_limits.window_started<=NOW()-interval '15 minutes'
         RETURNING attempts`,
        [normalised],
      );
      if (!reservation.rows.length) {
        const retry = await db.query<{ remaining: number }>(
          `SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM (window_started+interval '15 minutes'-NOW()))))::int AS remaining
           FROM login_limits WHERE email=$1`,
          [normalised],
        );
        throw new RateLimitError(Math.min(900, retry.rows[0]?.remaining || 900));
      }
      if (productionMode() && normalised.endsWith('@nqta.demo'))
        throw new Error('The sign-in credentials are incorrect.');
      const value = await db.transaction(async (tx) => {
        const { rows } = await tx.query<{
          id: string;
          password_hash: string;
          email_verified: boolean;
          auth_method: 'verified-contact' | 'recovery-key';
        }>(
          'SELECT id,password_hash,email_verified,auth_method FROM staff WHERE email=$1 AND active=true FOR UPDATE',
          [normalised],
        );
        if (!rows[0] || !verifyPassword(password, rows[0].password_hash))
          return { error: 'The sign-in credentials are incorrect.' };
        if (productionMode() && rows[0].auth_method !== 'recovery-key' && !rows[0].email_verified)
          return { error: 'Please verify your email before signing in.' };
        const sessionToken = token();
        await tx.query(
          "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,$3,'staff',NOW()+interval '7 days')",
          [id(), hashToken(sessionToken), rows[0].id],
        );
        return { token: sessionToken };
      });
      if ('error' in value) {
        await db.query('INSERT INTO login_attempts(id,email) VALUES($1,$2)', [id(), normalised]);
        throw new Error(value.error);
      }
      await db.query('DELETE FROM login_attempts WHERE email=$1', [normalised]);
      await db.query('DELETE FROM login_limits WHERE email=$1', [normalised]);
      return value.token;
    },
    async getStaffActor(value: string): Promise<Actor> {
      if (!value) throw new Error('Please sign in to your workspace.');
      const { rows } = await db.query<{
        id: string;
        shop_id: string;
        role: Actor['role'];
        name: string;
        email: string;
        email_verified: boolean;
        auth_method: 'verified-contact' | 'recovery-key';
      }>(
        `SELECT st.id,st.shop_id,st.role,st.name,st.email,st.email_verified,st.auth_method FROM sessions se JOIN staff st ON st.id=se.principal_id
        WHERE se.token_hash=$1 AND se.kind='staff' AND se.expires_at>NOW() AND st.active=true`,
        [hashToken(value)],
      );
      if (
        !rows[0] ||
        (productionMode() &&
          ((rows[0].auth_method !== 'recovery-key' && !rows[0].email_verified) ||
            rows[0].email.endsWith('@nqta.demo')))
      )
        throw new Error('Your session is unavailable. Please sign in again.');
      return {
        userId: rows[0].id,
        shopId: rows[0].shop_id,
        role: rows[0].role,
        name: rows[0].name,
      };
    },
    async inviteStaff(
      actor: Actor,
      input: { name: string; email: string; role: 'owner' | 'cashier' },
    ): Promise<{ token: string }> {
      if (
        !input.name.trim() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) ||
        !['owner', 'cashier'].includes(input.role)
      )
        throw new Error('Enter a name, valid email, and staff role.');
      const email = input.email.trim().toLowerCase();
      if (productionMode() && email.endsWith('@nqta.demo'))
        throw new Error(
          'This email address is reserved for testing. Use a real staff email address.',
        );
      return db.transaction(async (tx) => {
        await assertActor(tx, actor, true, true);
        if ((await tx.query('SELECT id FROM staff WHERE email=$1', [email])).rows.length)
          throw new Error('A staff account with this email already exists.');
        const invitationToken = token();
        const invitationId = id();
        await tx.query(
          'INSERT INTO staff_invitations(id,shop_id,name,email,role,token_hash) VALUES($1,$2,$3,$4,$5,$6)',
          [
            invitationId,
            actor.shopId,
            input.name.trim(),
            email,
            input.role,
            hashToken(invitationToken),
          ],
        );
        await auditEvent(tx, actor.shopId, actor.userId, 'staff.invited', invitationId);
        return { token: invitationToken };
      });
    },
    async acceptStaffInvite(
      invitationToken: string,
      password: string,
    ): Promise<{
      recoveryKey?: string;
      verificationRequired?: boolean;
      verificationDeliveryFailed?: boolean;
    }> {
      const live = productionMode();
      const useKey = recoveryKeyMode();
      const recoveryKey = useKey ? token() : undefined;
      const email = await db.transaction(async (tx) => {
        const { rows } = await tx.query<{
          id: string;
          shop_id: string;
          name: string;
          email: string;
          role: string;
        }>(
          'SELECT * FROM staff_invitations WHERE token_hash=$1 AND used=false AND expires_at>NOW() FOR UPDATE',
          [hashToken(invitationToken)],
        );
        const invitation = rows[0];
        if (!invitation) throw new Error('This invitation is expired or has already been used.');
        if (live && invitation.email.trim().toLowerCase().endsWith('@nqta.demo'))
          throw new Error(
            'This email address is reserved for testing. Use a real staff email address.',
          );
        const passwordHash = await hashPassword(password);
        const staffId = id();
        await tx.query(
          'INSERT INTO staff(id,shop_id,name,email,password_hash,role,email_verified,auth_method,recovery_key_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            staffId,
            invitation.shop_id,
            invitation.name,
            invitation.email,
            passwordHash,
            invitation.role,
            !live && !useKey,
            useKey ? 'recovery-key' : 'verified-contact',
            recoveryKey ? hashToken(recoveryKey) : null,
          ],
        );
        await tx.query('UPDATE staff_invitations SET used=true WHERE id=$1', [invitation.id]);
        await auditEvent(
          tx,
          invitation.shop_id,
          staffId,
          'staff.invitation.accepted',
          invitation.id,
        );
        return invitation.email;
      });
      if (recoveryKey) return { recoveryKey };
      if (!live) return {};
      try {
        await createStaffRecoveryService(db).sendInitialVerification(email);
        return { verificationRequired: true };
      } catch (error) {
        if (!(error instanceof DeliveryError) && !(error instanceof RateLimitError)) throw error;
        return { verificationRequired: true, verificationDeliveryFailed: true };
      }
    },
    async revokeStaff(actor: Actor, userId: string): Promise<void> {
      await db.transaction(async (tx) => {
        await assertActor(tx, actor, true, true);
        if (userId === actor.userId) throw new Error('You cannot revoke your own owner access.');
        const { rows } = await tx.query(
          'UPDATE staff SET active=false WHERE id=$1 AND shop_id=$2 RETURNING id',
          [userId, actor.shopId],
        );
        if (!rows.length) throw new Error('Staff member not found or access denied.');
        await tx.query("DELETE FROM sessions WHERE principal_id=$1 AND kind='staff'", [userId]);
        await auditEvent(tx, actor.shopId, actor.userId, 'staff.revoked', userId);
      });
    },
    async signOut(value: string) {
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(value)]);
    },
  };
}
