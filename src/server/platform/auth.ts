import { z } from 'zod';
import type { Database } from '../db/client';
import { hashPassword, hashToken, id, token, verifyPassword } from '../auth/crypto';
import { reserveLimit } from '../auth/rate-limit';

export type PlatformIdentity = {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
};
export class PlatformAuthError extends Error {
  constructor(
    message = 'Please sign in as a platform administrator.',
    readonly status = 401,
  ) {
    super(message);
  }
}
const dummyHash = `scrypt:platform-unknown-account:${'0'.repeat(128)}`;
const adminInput = z.object({
  email: z.email().trim().max(200),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(14).max(200),
});
export async function provisionAdmin(
  db: Database,
  input: { email: string; name: string; password: string },
) {
  const clean = adminInput.parse({ ...input, email: input.email.trim().toLowerCase() });
  const passwordHash = await hashPassword(clean.password);
  const adminId = id();
  const result = await db.query<{ id: string }>(
    'INSERT INTO platform_admins(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id',
    [adminId, clean.email, clean.name, passwordHash],
  );
  if (!result.rows.length)
    throw new Error('This administrator already exists. No credentials were changed.');
  return { id: adminId, email: clean.email };
}
export async function requirePlatformAdmin(db: Database, adminId: string) {
  const row = (
    await db.query<{ must_change_password: boolean }>(
      'SELECT must_change_password FROM platform_admins WHERE id=$1 AND active=true',
      [adminId],
    )
  ).rows[0];
  if (!row) throw new PlatformAuthError();
  if (row.must_change_password)
    throw new PlatformAuthError('Change your temporary administrator password first.', 403);
}
async function issueSession(db: Database, adminId: string) {
  const value = token();
  await db.query('DELETE FROM platform_admin_sessions WHERE admin_id=$1 AND expires_at<=NOW()', [
    adminId,
  ]);
  await db.query(
    "INSERT INTO platform_admin_sessions(id,admin_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+interval '12 hours')",
    [id(), adminId, hashToken(value)],
  );
  return value;
}
export function createPlatformAuth(db: Database) {
  return {
    async signIn(email: string, password: string) {
      const normalised = email.trim().toLowerCase();
      if (normalised.length > 200 || password.length > 200)
        throw new PlatformAuthError('The sign-in credentials are incorrect.');
      await reserveLimit(db, {
        scope: 'platform-sign-in-account',
        key: normalised,
        limit: 5,
        windowSeconds: 900,
      });
      return db.transaction(async (tx) => {
        const row = (
          await tx.query<{ id: string; password_hash: string }>(
            'SELECT id,password_hash FROM platform_admins WHERE email=$1 AND active=true FOR UPDATE',
            [normalised],
          )
        ).rows[0];
        const correct = verifyPassword(password, row?.password_hash || dummyHash);
        if (!row || !correct) throw new PlatformAuthError('The sign-in credentials are incorrect.');
        return issueSession(tx, row.id);
      });
    },
    async getIdentity(value: string): Promise<PlatformIdentity> {
      if (!value) throw new PlatformAuthError();
      const row = (
        await db.query<PlatformIdentity>(
          `SELECT a.id,a.email,a.name,a.must_change_password AS "mustChangePassword"
        FROM platform_admin_sessions s JOIN platform_admins a ON a.id=s.admin_id
        WHERE s.token_hash=$1 AND s.expires_at>NOW() AND a.active=true`,
          [hashToken(value)],
        )
      ).rows[0];
      if (!row) throw new PlatformAuthError();
      return row;
    },
    async changePassword(value: string, currentPassword: string, nextPassword: string) {
      if (nextPassword.length < 14 || nextPassword.length > 200 || nextPassword === currentPassword)
        throw new Error('Use a different password of 14–200 characters.');
      const identity = await this.getIdentity(value);
      await reserveLimit(db, {
        scope: 'platform-password-change',
        key: identity.id,
        limit: 5,
        windowSeconds: 900,
      });
      const nextHash = await hashPassword(nextPassword);
      return db.transaction(async (tx) => {
        const row = (
          await tx.query<{ id: string; password_hash: string }>(
            `SELECT a.id,a.password_hash FROM platform_admins a
          JOIN platform_admin_sessions s ON s.admin_id=a.id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND a.active=true FOR UPDATE OF a,s`,
            [hashToken(value)],
          )
        ).rows[0];
        if (!row) throw new PlatformAuthError();
        if (!verifyPassword(currentPassword, row.password_hash))
          throw new Error('The current password is incorrect.');
        await tx.query(
          'UPDATE platform_admins SET password_hash=$1,must_change_password=false WHERE id=$2',
          [nextHash, row.id],
        );
        await tx.query('DELETE FROM platform_admin_sessions WHERE admin_id=$1', [row.id]);
        await tx.query(
          "INSERT INTO platform_audit(id,admin_id,action) VALUES($1,$2,'admin.password_changed')",
          [id(), row.id],
        );
        return issueSession(tx, row.id);
      });
    },
    async signOut(value: string) {
      await db.query('DELETE FROM platform_admin_sessions WHERE token_hash=$1', [hashToken(value)]);
    },
  };
}
