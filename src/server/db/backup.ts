import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { z } from 'zod';
import type { Database } from './client';
import { migrationChecksum, migrationHistoryStatement, migrations } from './migrate';

const MAGIC = Buffer.from('NQTA-ENCRYPTED-BACKUP-1\n');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const messages = {
  'invalid-key': 'BACKUP_ENCRYPTION_KEY must be a canonical base64 encoding of 32 random bytes.',
  'invalid-artifact': 'Encrypted backup authentication or format validation failed.',
  'incompatible-migrations':
    'The backup migration history is incompatible with this application version.',
  'incompatible-schema': 'The backup schema is incompatible with this application version.',
  'nonempty-target': 'Restore requires an empty target schema with no tables, views or sequences.',
  'database-error':
    'Database backup or restore failed; a failed restore leaves the target unchanged.',
  'artifact-file-error':
    'The private encrypted artifact could not be created; existing files are never replaced.',
} as const;

export class BackupError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = 'BackupError';
  }
}

const columnSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    nullable: z.boolean(),
    defaultValue: z.string().nullable(),
    identity: z.string(),
    generated: z.string(),
  })
  .strict();
const foreignKeySchema = z
  .object({
    column: z.string().min(1),
    referencedTable: z.string().min(1),
    referencedColumn: z.string().min(1),
  })
  .strict();
const tableSchema = z
  .object({
    name: z.string().min(1),
    columns: z.array(columnSchema).min(1),
    foreignKeys: z.array(foreignKeySchema),
    rows: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();
const snapshotSchema = z
  .object({
    format: z.literal('nqta-database-snapshot'),
    version: z.literal(1),
    createdAt: z.string(),
    tables: z.array(tableSchema),
  })
  .strict();
type Snapshot = z.infer<typeof snapshotSchema>;
type Table = Snapshot['tables'][number];
type Column = Table['columns'][number];
type ForeignKey = Table['foreignKeys'][number];
export type BackupSummary = { tables: number; rows: number };

export async function writeEncryptedBackupFile(filename: string, data: Uint8Array): Promise<void> {
  const artifact = Buffer.from(data);
  if (
    !artifact.subarray(0, MAGIC.length).equals(MAGIC) ||
    artifact.length <= MAGIC.length + IV_LENGTH + TAG_LENGTH
  )
    throw new BackupError('invalid-artifact');
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(filename, 'wx', 0o600);
    await file.chmod(0o600);
    await file.writeFile(artifact);
    await file.sync();
  } catch {
    if (file) await unlink(filename).catch(() => {});
    throw new BackupError('artifact-file-error');
  } finally {
    await file?.close();
  }
}

const applicationTables = [
  'nqta_schema_migrations',
  ...migrations.flatMap((migration) =>
    migration.statements.flatMap((statement) => {
      const name = statement.match(
        /^\s*CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(/i,
      )?.[1];
      return name ? [name] : [];
    }),
  ),
].sort();

function identifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function encryptionKey(value: string) {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new BackupError('invalid-key');
  return key;
}

function summary(snapshot: Snapshot): BackupSummary {
  return {
    tables: snapshot.tables.length,
    rows: snapshot.tables.reduce((count, table) => count + table.rows.length, 0),
  };
}

function assertTableNames(names: string[]) {
  if (JSON.stringify([...names].sort()) !== JSON.stringify(applicationTables))
    throw new BackupError('incompatible-schema');
}

function assertMigrationHistory(snapshot: Snapshot) {
  const history = snapshot.tables.find((table) => table.name === 'nqta_schema_migrations')?.rows;
  if (!history || history.length !== migrations.length)
    throw new BackupError('incompatible-migrations');
  const ordered = [...history].sort((left, right) => Number(left.version) - Number(right.version));
  for (const [index, migration] of migrations.entries()) {
    const row = ordered[index];
    if (
      Number(row.version) !== migration.version ||
      row.name !== migration.name ||
      row.checksum !== migrationChecksum(migration)
    )
      throw new BackupError('incompatible-migrations');
  }
}

function assertSnapshot(snapshot: Snapshot) {
  assertTableNames(snapshot.tables.map((table) => table.name));
  assertMigrationHistory(snapshot);
  for (const table of snapshot.tables) {
    const columns = table.columns.map((column) => column.name).sort();
    if (new Set(columns).size !== columns.length) throw new BackupError('incompatible-schema');
    for (const row of table.rows) {
      if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(columns))
        throw new BackupError('incompatible-schema');
    }
  }
}

async function readSchema(db: Database): Promise<Omit<Table, 'rows'>[]> {
  const names = (
    await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name",
    )
  ).rows.map((row) => row.table_name);
  assertTableNames(names);
  const columns = (
    await db.query<{
      table_name: string;
      column_name: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      is_identity: string;
      is_generated: string;
    }>(
      'SELECT table_name,column_name,udt_name,is_nullable,column_default,is_identity,is_generated FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,ordinal_position',
    )
  ).rows;
  const foreignKeys = (
    await db.query<{
      table_name: string;
      column_name: string;
      referenced_table: string;
      referenced_column: string;
      local_reference: boolean;
    }>(`SELECT src.relname AS table_name,src_column.attname AS column_name,
    dst.relname AS referenced_table,dst_column.attname AS referenced_column,
    src_namespace.nspname=dst_namespace.nspname AS local_reference
    FROM pg_constraint constraint_row
    JOIN pg_class src ON src.oid=constraint_row.conrelid
    JOIN pg_namespace src_namespace ON src_namespace.oid=src.relnamespace
    JOIN pg_class dst ON dst.oid=constraint_row.confrelid
    JOIN pg_namespace dst_namespace ON dst_namespace.oid=dst.relnamespace
    JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY src_key(attnum,position) ON true
    JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY dst_key(attnum,position) ON dst_key.position=src_key.position
    JOIN pg_attribute src_column ON src_column.attrelid=src.oid AND src_column.attnum=src_key.attnum
    JOIN pg_attribute dst_column ON dst_column.attrelid=dst.oid AND dst_column.attnum=dst_key.attnum
    WHERE constraint_row.contype='f' AND src_namespace.nspname=current_schema()
    ORDER BY src.relname,src_column.attname,dst.relname,dst_column.attname`)
  ).rows;
  if (foreignKeys.some((row) => !row.local_reference)) throw new BackupError('incompatible-schema');
  return names.map((name) => ({
    name,
    columns: columns
      .filter((column) => column.table_name === name)
      .map((column) => ({
        name: column.column_name,
        type: column.udt_name,
        nullable: column.is_nullable === 'YES',
        // Sequence names can be schema-qualified differently in a restored database.
        defaultValue: column.column_default?.startsWith('nextval(')
          ? 'owned-sequence'
          : column.column_default,
        identity: column.is_identity,
        generated: column.is_generated,
      })),
    foreignKeys: foreignKeys
      .filter((key) => key.table_name === name)
      .map((key) => ({
        column: key.column_name,
        referencedTable: key.referenced_table,
        referencedColumn: key.referenced_column,
      })),
  }));
}

function columnSelection(column: Column) {
  const name = identifier(column.name);
  // Driver Date/number conversion would discard microseconds or large numeric values.
  if (
    [
      'date',
      'timestamp',
      'timestamptz',
      'time',
      'timetz',
      'int2',
      'int4',
      'int8',
      'numeric',
      'float4',
      'float8',
      'json',
      'jsonb',
    ].includes(column.type)
  )
    return `${name}::text AS ${name}`;
  if (column.type === 'bytea') return `encode(${name},'base64') AS ${name}`;
  return name;
}

export async function createEncryptedBackup(
  db: Database,
  base64Key: string,
): Promise<BackupSummary & { data: Buffer }> {
  const key = encryptionKey(base64Key);
  try {
    const snapshot = await db.transaction(async (tx): Promise<Snapshot> => {
      if (db.dialect === 'postgres')
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const schema = await readSchema(tx);
      const tables: Table[] = [];
      for (const table of schema) {
        const { rows } = await tx.query(
          `SELECT ${table.columns.map(columnSelection).join(',')} FROM ${identifier(table.name)}`,
        );
        tables.push({ ...table, rows });
      }
      const result: Snapshot = {
        format: 'nqta-database-snapshot',
        version: 1,
        createdAt: new Date().toISOString(),
        tables,
      };
      assertSnapshot(result);
      return result;
    });
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(MAGIC);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(snapshot), 'utf8'),
      cipher.final(),
    ]);
    return {
      ...summary(snapshot),
      data: Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]),
    };
  } catch (error) {
    throw error instanceof BackupError ? error : new BackupError('database-error');
  } finally {
    key.fill(0);
  }
}

function decryptSnapshot(data: Uint8Array, key: Buffer): Snapshot {
  try {
    const artifact = Buffer.from(data);
    const offset = MAGIC.length;
    if (
      artifact.length <= offset + IV_LENGTH + TAG_LENGTH ||
      !artifact.subarray(0, offset).equals(MAGIC)
    )
      throw new BackupError('invalid-artifact');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      artifact.subarray(offset, offset + IV_LENGTH),
    );
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(artifact.subarray(offset + IV_LENGTH, offset + IV_LENGTH + TAG_LENGTH));
    const plaintext = Buffer.concat([
      decipher.update(artifact.subarray(offset + IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]);
    try {
      const snapshot = snapshotSchema.parse(JSON.parse(plaintext.toString('utf8')));
      assertSnapshot(snapshot);
      return snapshot;
    } finally {
      plaintext.fill(0);
    }
  } catch (error) {
    throw error instanceof BackupError ? error : new BackupError('invalid-artifact');
  }
}

function orderedTables(tables: Table[]) {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const active = new Set<string>();
  const complete = new Set<string>();
  const result: Table[] = [];
  const visit = (name: string) => {
    if (complete.has(name)) return;
    const table = byName.get(name);
    if (!table || active.has(name)) throw new BackupError('incompatible-schema');
    active.add(name);
    for (const key of table.foreignKeys)
      if (key.referencedTable !== name) visit(key.referencedTable);
    active.delete(name);
    complete.add(name);
    result.push(table);
  };
  for (const table of tables) visit(table.name);
  return result;
}

function orderedRows(table: Table) {
  const references = table.foreignKeys.filter((key) => key.referencedTable === table.name);
  if (!references.length) return table.rows;
  const lookups = references.map(
    (key) => new Map(table.rows.map((row, index) => [row[key.referencedColumn], index])),
  );
  const dependencies = table.rows.map((row, index) => {
    const parents = new Set<number>();
    for (const [keyIndex, reference] of references.entries()) {
      const value = row[reference.column];
      if (value == null) continue;
      const parent = lookups[keyIndex].get(value);
      if (parent == null) throw new BackupError('incompatible-schema');
      if (parent !== index) parents.add(parent);
    }
    return parents;
  });
  const children = table.rows.map(() => [] as number[]);
  dependencies.forEach((parents, index) =>
    parents.forEach((parent) => children[parent].push(index)),
  );
  const queue = dependencies.flatMap((parents, index) => (parents.size ? [] : [index]));
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const child of children[queue[cursor]]) {
      dependencies[child].delete(queue[cursor]);
      if (!dependencies[child].size) queue.push(child);
    }
  }
  if (queue.length !== table.rows.length) throw new BackupError('incompatible-schema');
  return queue.map((index) => table.rows[index]);
}

function restoreValue(value: unknown, column: Column) {
  if (value == null) return null;
  if (column.type === 'json' || column.type === 'jsonb')
    return typeof value === 'string' ? value : JSON.stringify(value);
  if (column.type === 'bytea') {
    if (typeof value !== 'string') throw new BackupError('invalid-artifact');
    return Buffer.from(value, 'base64');
  }
  return value;
}

async function insertRows(db: Database, table: Table) {
  const rows = orderedRows(table);
  const columns = table.columns.filter((column) => column.generated !== 'ALWAYS');
  const chunkSize = Math.min(500, Math.floor(60000 / columns.length));
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const placeholders = chunk
      .map(
        (row) =>
          `(${columns
            .map((column) => {
              values.push(restoreValue(row[column.name], column));
              return `$${values.length}`;
            })
            .join(',')})`,
      )
      .join(',');
    const override = columns.some((column) => column.identity === 'YES')
      ? ' OVERRIDING SYSTEM VALUE'
      : '';
    await db.query(
      `INSERT INTO ${identifier(table.name)}(${columns.map((column) => identifier(column.name)).join(',')})${override} VALUES ${placeholders}`,
      values,
    );
  }
}

function schemaSignature(tables: Omit<Table, 'rows'>[]) {
  return JSON.stringify(
    tables
      .map((table) => ({
        name: table.name,
        columns: [...table.columns].sort((left, right) => left.name.localeCompare(right.name)),
        foreignKeys: table.foreignKeys,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

export async function restoreEncryptedBackup(
  db: Database,
  data: Uint8Array,
  base64Key: string,
): Promise<BackupSummary> {
  const key = encryptionKey(base64Key);
  let snapshot: Snapshot;
  try {
    snapshot = decryptSnapshot(data, key);
  } finally {
    key.fill(0);
  }
  try {
    await db.transaction(async (tx) => {
      if (db.dialect === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(1852929121, 1)');
      const { rows } = await tx.query<{ occupied: boolean }>(`SELECT
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema()) OR
        EXISTS(SELECT 1 FROM information_schema.sequences WHERE sequence_schema=current_schema()) OR
        EXISTS(SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
          WHERE namespace.nspname=current_schema() AND relation.relkind='m') AS occupied`);
      if (rows[0].occupied) throw new BackupError('nonempty-target');
      for (const migration of migrations)
        for (const statement of migration.statements) await tx.query(statement);
      await tx.query(migrationHistoryStatement);
      const targetSchema = await readSchema(tx);
      if (schemaSignature(targetSchema) !== schemaSignature(snapshot.tables))
        throw new BackupError('incompatible-schema');
      for (const table of orderedTables(snapshot.tables)) await insertRows(tx, table);
      for (const table of snapshot.tables)
        for (const column of table.columns) {
          if (column.defaultValue !== 'owned-sequence' && column.identity !== 'YES') continue;
          const sequence = (
            await tx.query<{ sequence: string | null }>(
              'SELECT pg_get_serial_sequence($1,$2) AS sequence',
              [identifier(table.name), column.name],
            )
          ).rows[0].sequence;
          if (!sequence) throw new BackupError('incompatible-schema');
          await tx.query(
            `SELECT setval($1::regclass,GREATEST(COALESCE(MAX(${identifier(column.name)}),1),1),COUNT(*)>0) FROM ${identifier(table.name)}`,
            [sequence],
          );
        }
    });
    return summary(snapshot);
  } catch (error) {
    throw error instanceof BackupError ? error : new BackupError('database-error');
  }
}
