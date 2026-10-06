import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase } from '../../src/server/db/client';
it('initialises a fresh nested data directory and restores records after reopening', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nqta-persistence-'));
  const location = path.join(directory, 'fresh', 'database');
  try {
    const db = await createDatabase(location);
    await db.query('CREATE TABLE persistence_check(value text)');
    await db.query("INSERT INTO persistence_check(value) VALUES('saved')");
    await db.close();
    const reopened = await createDatabase(location);
    expect(
      (await reopened.query<{ value: string }>('SELECT value FROM persistence_check')).rows[0]
        .value,
    ).toBe('saved');
    await reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
