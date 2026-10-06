import type { Database } from '../db/client';
import type { Actor } from '../loyalty/types';
import { hashPassword, hashToken, id, token, verifyPassword } from './crypto';
import { assertActor } from './permissions';
import { auditEvent } from '../audit';
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
      if (!reservation.rows.length)
        throw new Error('Too many sign-in attempts. Try again in 15 minutes.');
      const { rows } = await db.query<{ id: string; password_hash: string }>(
        'SELECT id,password_hash FROM staff WHERE email=$1 AND active=true',
        [normalised],
      );
      if (!rows[0] || !verifyPassword(password, rows[0].password_hash)) {
        await db.query('INSERT INTO login_attempts(id,email) VALUES($1,$2)', [id(), normalised]);
        throw new Error('The sign-in credentials are incorrect.');
      }
      const value = token();
      await db.query(
        "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,$3,'staff',NOW()+interval '7 days')",
        [id(), hashToken(value), rows[0].id],
      );
      await db.query('DELETE FROM login_attempts WHERE email=$1', [normalised]);
      await db.query('DELETE FROM login_limits WHERE email=$1', [normalised]);
      return value;
    },
    async getStaffActor(value: string): Promise<Actor> {
      if (!value) throw new Error('Please sign in to your workspace.');
      const { rows } = await db.query<{
        id: string;
        shop_id: string;
        role: Actor['role'];
        name: string;
      }>(
        `SELECT st.id,st.shop_id,st.role,st.name FROM sessions se JOIN staff st ON st.id=se.principal_id
        WHERE se.token_hash=$1 AND se.kind='staff' AND se.expires_at>NOW() AND st.active=true`,
        [hashToken(value)],
      );
      if (!rows[0]) throw new Error('Your session is unavailable. Please sign in again.');
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
    async acceptStaffInvite(invitationToken: string, password: string): Promise<void> {
      const passwordHash = await hashPassword(password);
      await db.transaction(async (tx) => {
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
        const staffId = id();
        await tx.query(
          'INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',
          [
            staffId,
            invitation.shop_id,
            invitation.name,
            invitation.email,
            passwordHash,
            invitation.role,
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
      });
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
