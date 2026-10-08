import {
  assertRuntimeConfiguration,
  authMode,
  ConfigurationError,
  productionMode,
} from '../src/server/environment';
import { getDatabase } from '../src/server/db/client';
import { migrations } from '../src/server/db/migrate';

async function main() {
  let db: Awaited<ReturnType<typeof getDatabase>> | undefined;
  try {
    if (!productionMode())
      throw new ConfigurationError(
        'Turn off hosted testing before checking a real production environment.',
      );
    assertRuntimeConfiguration();
    db = await getDatabase();
    await db.query('SELECT 1');
    const history = await db.query<{ version: number }>(
      'SELECT version FROM nqta_schema_migrations ORDER BY version',
    );
    if (history.rows.length !== migrations.length) throw new Error('Schema version mismatch.');
    const unverified = await db.query(
      "SELECT id FROM staff WHERE active=true AND email_verified=false AND auth_method='verified-contact'",
    );
    console.log(
      JSON.stringify({
        configuration: 'valid',
        database: 'reachable',
        schema: 'current',
        demoRecords: 'absent',
        unverifiedStaff: unverified.rows.length,
        authentication: authMode(),
        liveDelivery:
          authMode() === 'recovery-key'
            ? 'not used for account access'
            : 'requires actual SMS/email verification',
        accountRecovery: 'requires real signup, second-device sign-in and recovery checks',
        physicalPhones: 'requires launch check',
      }),
    );
  } catch (error) {
    console.error(
      error instanceof ConfigurationError
        ? error.message
        : 'Production preflight failed. Check the schema and private database configuration.',
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
