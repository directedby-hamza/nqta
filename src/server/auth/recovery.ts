import type { Database } from '../db/client';
import { demoMode, productionMode } from '../environment';
import { deliverStaffEmail, DeliveryError } from '../providers/email';
import { auditEvent } from '../audit';
import { applicationOrigin } from './origin';
import { hashPassword, hashToken, id, token } from './crypto';
import { reserveLimit } from './rate-limit';

type Kind = 'verify' | 'reset';
type RequestResult = { ok: true; developmentUrl?: string };
type Staff = {
  id: string;
  shop_id: string;
  email: string;
  active: boolean;
  email_verified: boolean;
  auth_method: 'verified-contact' | 'recovery-key';
};

export function createStaffRecoveryService(db: Database) {
  async function request(email: string, kind: Kind): Promise<RequestResult> {
    const normalised = email.trim().toLowerCase();
    if (normalised.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised))
      throw new Error('Enter a valid email address.');
    await reserveLimit(db, {
      scope: 'staff-recovery-email',
      key: normalised,
      limit: 3,
      windowSeconds: 900,
    });
    await reserveLimit(db, {
      scope: 'staff-recovery-global',
      key: 'all',
      limit: 1000,
      windowSeconds: 86400,
    });
    const staff = (
      await db.query<Staff>(
        "SELECT id,shop_id,email,active,email_verified,auth_method FROM staff WHERE email=$1 AND active=true AND auth_method='verified-contact'",
        [normalised],
      )
    ).rows[0];
    if (
      !staff ||
      (productionMode() && staff.email.endsWith('@nqta.demo')) ||
      (kind === 'verify' && staff.email_verified)
    )
      return { ok: true };
    const value = token();
    const challengeId = id();
    const url = new URL(
      kind === 'verify' ? '/verify-email' : '/reset-password',
      applicationOrigin(),
    );
    url.searchParams.set('token', value);
    const persisted = await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [staff.shop_id]);
      const current = (
        await tx.query<Staff>(
          'SELECT id,shop_id,email,active,email_verified,auth_method FROM staff WHERE id=$1 FOR UPDATE',
          [staff.id],
        )
      ).rows[0];
      if (
        !current?.active ||
        current.auth_method !== 'verified-contact' ||
        (kind === 'verify' && current.email_verified)
      )
        return false;
      await tx.query(
        'UPDATE staff_email_tokens SET used=true WHERE staff_id=$1 AND kind=$2 AND used=false',
        [staff.id, kind],
      );
      await tx.query(
        `INSERT INTO staff_email_tokens(id,staff_id,token_hash,kind,expires_at) VALUES($1,$2,$3,$4,NOW()+($5::int * interval '1 second'))`,
        [challengeId, staff.id, hashToken(value), kind, kind === 'verify' ? 86400 : 1800],
      );
      return true;
    });
    if (!persisted) return { ok: true };
    try {
      await deliverStaffEmail(staff.email, url.toString(), kind);
    } catch (error) {
      await db.query('UPDATE staff_email_tokens SET used=true WHERE id=$1', [challengeId]);
      throw error;
    }
    return { ok: true, ...(demoMode() ? { developmentUrl: url.toString() } : {}) };
  }

  async function consume<T>(
    value: string,
    kind: Kind,
    operation: (tx: Database, staff: Staff) => Promise<T>,
  ): Promise<T> {
    if (!/^[a-f0-9]{64}$/.test(value))
      throw new Error('This email link is invalid, expired, or already used.');
    return db.transaction(async (tx) => {
      const candidate = (
        await tx.query<Staff>(
          'SELECT st.id,st.shop_id,st.email,st.active,st.email_verified,st.auth_method FROM staff_email_tokens t JOIN staff st ON st.id=t.staff_id WHERE t.token_hash=$1 AND t.kind=$2',
          [hashToken(value), kind],
        )
      ).rows[0];
      if (!candidate) throw new Error('This email link is invalid, expired, or already used.');
      await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [candidate.shop_id]);
      const staff = (
        await tx.query<Staff>(
          'SELECT id,shop_id,email,active,email_verified,auth_method FROM staff WHERE id=$1 FOR UPDATE',
          [candidate.id],
        )
      ).rows[0];
      const challenge = (
        await tx.query<{ id: string }>(
          'SELECT id FROM staff_email_tokens WHERE token_hash=$1 AND kind=$2 AND used=false AND expires_at>NOW() FOR UPDATE',
          [hashToken(value), kind],
        )
      ).rows[0];
      if (
        !challenge ||
        !staff?.active ||
        staff.auth_method !== 'verified-contact' ||
        (productionMode() && staff.email.endsWith('@nqta.demo'))
      )
        throw new Error('This email link is invalid, expired, or already used.');
      await tx.query(
        'UPDATE staff_email_tokens SET used=true WHERE staff_id=$1 AND kind=$2 AND used=false',
        [staff.id, kind],
      );
      return operation(tx, staff);
    });
  }

  async function acceptPublicRequest(email: string, kind: Kind): Promise<RequestResult> {
    try {
      return await request(email, kind);
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
      return { ok: true };
    }
  }

  return {
    requestVerification: (email: string) => acceptPublicRequest(email, 'verify'),
    requestPasswordReset: (email: string) => acceptPublicRequest(email, 'reset'),
    // Registration and accepted invitations already identify a newly committed account.
    // Those flows need a delivery outcome so they can offer verification resend.
    sendInitialVerification: (email: string) => request(email, 'verify'),
    async verifyEmail(value: string): Promise<{ token: string }> {
      return consume(value, 'verify', async (tx, staff) => {
        await tx.query('UPDATE staff SET email_verified=true WHERE id=$1', [staff.id]);
        const sessionToken = token();
        await tx.query(
          "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,$3,'staff',NOW()+interval '7 days')",
          [id(), hashToken(sessionToken), staff.id],
        );
        await auditEvent(tx, staff.shop_id, staff.id, 'staff.email.verified', staff.id);
        return { token: sessionToken };
      });
    },
    async resetPassword(value: string, password: string): Promise<void> {
      await consume(value, 'reset', async (tx, staff) => {
        const passwordHash = await hashPassword(password);
        await tx.query('UPDATE staff SET password_hash=$1 WHERE id=$2', [passwordHash, staff.id]);
        await tx.query("DELETE FROM sessions WHERE principal_id=$1 AND kind='staff'", [staff.id]);
        await tx.query('DELETE FROM login_limits WHERE email=$1', [staff.email]);
        await tx.query('DELETE FROM login_attempts WHERE email=$1', [staff.email]);
        await auditEvent(tx, staff.shop_id, staff.id, 'staff.password.reset', staff.id);
      });
    },
  };
}
