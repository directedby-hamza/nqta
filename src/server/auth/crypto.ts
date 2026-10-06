import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export function id() {
  return crypto.randomUUID();
}
export function token() {
  return randomBytes(32).toString('hex');
}
export function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function hashCode(context: string, code: string) {
  const secret = process.env.SESSION_SECRET || 'nqta-development-only-secret';
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  )
    throw new Error('A production SESSION_SECRET must be configured.');
  return createHmac('sha256', secret).update(`${context}:${code}`).digest('hex');
}
export async function hashPassword(password: string) {
  if (password.length < 10 || password.length > 200)
    throw new Error('Use a password of 10–200 characters.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string) {
  if (password.length > 200) return false;
  const [method, salt, digest] = encoded.split(':');
  if (method !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
