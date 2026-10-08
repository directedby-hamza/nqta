import { assertRuntimeConfiguration } from '../src/server/environment';
import { createDatabase } from '../src/server/db/client';
import { migrate, migrations } from '../src/server/db/migrate';

async function main() {
  let db: Awaited<ReturnType<typeof createDatabase>> | undefined;
  try {
    assertRuntimeConfiguration();
    if (!process.env.DATABASE_URL?.startsWith('postgres')) throw new Error('PostgreSQL required.');
    db = await createDatabase(process.env.DATABASE_URL);
    await migrate(db);
    console.log(
      `Database schema verified through migration ${migrations.length}. No demo seed was applied.`,
    );
  } catch {
    console.error(
      'Migration failed. Check the private environment and database permissions; no credentials are printed.',
    );
    process.exitCode = 1;
  } finally {
    await db?.close().catch(() => {
      console.error('Database connection cleanup failed.');
      process.exitCode = 1;
    });
  }
}
void main();
