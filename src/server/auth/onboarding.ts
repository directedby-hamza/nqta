import type { Database } from '../db/client';
import { hashPassword, hashToken, id, token } from './crypto';
import { auditEvent } from '../audit';
export async function createWorkspace(
  db: Database,
  input: {
    name: string;
    email: string;
    password: string;
    shopName: string;
    slug: string;
    category: string;
  },
): Promise<{ token: string }> {
  const email = input.email.trim().toLowerCase();
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
  return db.transaction(async (tx) => {
    if ((await tx.query('SELECT id FROM shops WHERE slug=$1', [input.slug])).rows.length)
      throw new Error('This shop URL is already taken.');
    if ((await tx.query('SELECT id FROM staff WHERE email=$1', [email])).rows.length)
      throw new Error('A staff account with this email already exists.');
    const shopId = id();
    const ownerId = id();
    const sessionToken = token();
    await tx.query('INSERT INTO shops(id,slug,name,category,description) VALUES($1,$2,$3,$4,$5)', [
      shopId,
      input.slug,
      input.shopName.trim(),
      input.category,
      'A little thank you for coming back.',
    ]);
    await tx.query(
      "INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,'owner')",
      [ownerId, shopId, input.name.trim(), email, passwordHash],
    );
    await tx.query(
      "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,$3,'staff',NOW()+interval '7 days')",
      [id(), hashToken(sessionToken), ownerId],
    );
    await auditEvent(tx, shopId, ownerId, 'workspace.created', shopId);
    return { token: sessionToken };
  });
}
