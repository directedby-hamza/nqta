import type { Database } from '../db/client';
import { hashPassword, hashToken, id, token } from './crypto';
import { auditEvent } from '../audit';
import { productionMode, recoveryKeyMode } from '../environment';
import { DeliveryError } from '../providers/email';
import { createStaffRecoveryService } from './recovery';
import { RateLimitError } from './rate-limit';
export async function createWorkspace(
  db: Database,
  input: {
    name: string;
    email: string;
    password: string;
    shopName: string;
    slug: string;
    category: string;
    location?: string;
  },
): Promise<{
  token?: string;
  recoveryKey?: string;
  verificationRequired?: boolean;
  verificationDeliveryFailed?: boolean;
  developmentUrl?: string;
}> {
  const email = input.email.trim().toLowerCase();
  const live = productionMode();
  const useKey = recoveryKeyMode();
  if (live && email.endsWith('@nqta.demo'))
    throw new Error('This email address is reserved for testing. Use your real email address.');
  const location = input.location?.trim() || '';
  if (live && (!location || location.length > 200))
    throw new Error('Enter your shop location using no more than 200 characters.');
  if (
    !input.name.trim() ||
    !input.shopName.trim() ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) ||
    input.slug.length < 3 ||
    input.slug.length > 50
  )
    throw new Error('Enter a name, valid email, shop name, and shop URL.');
  const passwordHash = await hashPassword(input.password);
  const result = await db.transaction(async (tx) => {
    if ((await tx.query('SELECT id FROM shops WHERE slug=$1', [input.slug])).rows.length)
      throw new Error('This shop URL is already taken.');
    if ((await tx.query('SELECT id FROM staff WHERE email=$1', [email])).rows.length)
      throw new Error('A staff account with this email already exists.');
    const shopId = id();
    const ownerId = id();
    const sessionToken = !live || useKey ? token() : undefined;
    const recoveryKey = useKey ? token() : undefined;
    await tx.query(
      'INSERT INTO shops(id,slug,name,category,description,location) VALUES($1,$2,$3,$4,$5,$6)',
      [
        shopId,
        input.slug,
        input.shopName.trim(),
        input.category,
        'A little thank you for coming back.',
        location || 'Casablanca',
      ],
    );
    await tx.query(
      "INSERT INTO staff(id,shop_id,name,email,password_hash,role,email_verified,auth_method,recovery_key_hash) VALUES($1,$2,$3,$4,$5,'owner',$6,$7,$8)",
      [
        ownerId,
        shopId,
        input.name.trim(),
        email,
        passwordHash,
        !live && !useKey,
        useKey ? 'recovery-key' : 'verified-contact',
        recoveryKey ? hashToken(recoveryKey) : null,
      ],
    );
    if (sessionToken)
      await tx.query(
        "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,$3,'staff',NOW()+interval '7 days')",
        [id(), hashToken(sessionToken), ownerId],
      );
    await auditEvent(tx, shopId, ownerId, 'workspace.created', shopId);
    return sessionToken
      ? { token: sessionToken, ...(recoveryKey ? { recoveryKey } : {}) }
      : { verificationRequired: true };
  });
  if (!live || useKey) return result;
  try {
    await createStaffRecoveryService(db).sendInitialVerification(email);
    return { verificationRequired: true };
  } catch (error) {
    if (!(error instanceof DeliveryError) && !(error instanceof RateLimitError)) throw error;
    return { verificationRequired: true, verificationDeliveryFailed: true };
  }
}
