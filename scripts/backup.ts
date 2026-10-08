import { readFile } from 'node:fs/promises';
import { createDatabase, type Database } from '../src/server/db/client';
import {
  BackupError,
  createEncryptedBackup,
  restoreEncryptedBackup,
  writeEncryptedBackupFile,
} from '../src/server/db/backup';

async function main() {
  let db: Database | undefined;
  try {
    const [operation, filename, ...extra] = process.argv.slice(2);
    if (!['create', 'restore'].includes(operation) || !filename || extra.length)
      throw new Error('arguments');
    const location = process.env.DATABASE_URL || '';
    const key = process.env.BACKUP_ENCRYPTION_KEY || '';
    const url = new URL(location);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2 ||
      url.searchParams.getAll('sslmode').length !== 1 ||
      !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') || '')
    )
      throw new Error('configuration');
    const keyBytes = Buffer.from(key, 'base64');
    const validKey = keyBytes.length === 32 && keyBytes.toString('base64') === key;
    keyBytes.fill(0);
    if (!validKey) throw new BackupError('invalid-key');
    // Read the encrypted artifact before creating a restore connection; the restore API
    // authenticates it before beginning any database transaction.
    const artifact = operation === 'restore' ? await readFile(filename) : undefined;
    db = await createDatabase(location);
    if (operation === 'create') {
      const snapshot = await createEncryptedBackup(db, key);
      await writeEncryptedBackupFile(filename, snapshot.data);
      process.stdout.write(
        JSON.stringify({ status: 'created', tables: snapshot.tables, rows: snapshot.rows }) + '\n',
      );
    } else {
      const result = await restoreEncryptedBackup(db, artifact!, key);
      process.stdout.write(JSON.stringify({ status: 'restored', ...result }) + '\n');
    }
  } catch (error) {
    const code = error instanceof BackupError ? error.code : 'configuration-or-operation-failed';
    process.stderr.write(JSON.stringify({ status: 'failed', code }) + '\n');
    process.exitCode = 1;
  } finally {
    try {
      await db?.close();
    } catch {
      process.stderr.write(
        JSON.stringify({ status: 'failed', code: 'database-close-failed' }) + '\n',
      );
      process.exitCode = 1;
    }
  }
}

void main();
