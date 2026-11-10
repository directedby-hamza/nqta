import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createDatabase } from '../src/server/db/client';
import { migrate } from '../src/server/db/migrate';
import { seedDemo } from '../src/server/db/seed';
import { provisionAdmin } from '../src/server/platform/auth';

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL)
    throw new Error('Admin browser checks require an isolated local database.');
  const directory = await mkdtemp(path.join(tmpdir(), 'nqta-admin-e2e-'));
  const db = await createDatabase(directory);
  try {
    await migrate(db);
    await seedDemo(db);
    await provisionAdmin(db, {
      email: 'admin@browser.test',
      name: 'Browser administrator',
      password: 'BrowserTemporary123!',
    });
  } finally {
    await db.close();
  }
  const child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      process.env.NQTA_E2E_PORT || '3111',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATA_DIRECTORY: directory,
        DATABASE_URL: '',
        DEMO_MODE: 'true',
        HOSTED_TEST_MODE: 'false',
        AUTH_MODE: 'recovery-key',
      },
    },
  );
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}
void main();
