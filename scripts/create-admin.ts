import { createDatabase } from '../src/server/db/client';
import { migrate } from '../src/server/db/migrate';
import { provisionAdmin } from '../src/server/platform/auth';

async function main() {
  const email = process.env.NQTA_ADMIN_EMAIL;
  const password = process.env.NQTA_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error('Set NQTA_ADMIN_EMAIL and NQTA_ADMIN_PASSWORD in a private environment.');
  if (!process.env.DATABASE_URL?.startsWith('postgres'))
    throw new Error('Set the intended PostgreSQL DATABASE_URL.');
  const db = await createDatabase(process.env.DATABASE_URL);
  try {
    await migrate(db);
    await provisionAdmin(db, {
      email,
      password,
      name: process.env.NQTA_ADMIN_NAME || 'Nqta administrator',
    });
    console.log(
      'Administrator created. The first sign-in requires a new password. No password was printed.',
    );
  } finally {
    await db.close();
  }
}
void main().catch(() => {
  console.error(
    'Administrator creation failed. Verify the private configuration; existing credentials are never overwritten.',
  );
  process.exitCode = 1;
});
