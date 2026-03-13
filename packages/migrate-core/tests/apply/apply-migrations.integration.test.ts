import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, connectPostgres, getMigrationStatus } from '../../src/index.js';
import { getTestDatabaseUrl } from '../helpers.js';

const databaseUrl = getTestDatabaseUrl();
const maybeDescribe = databaseUrl ? describe : describe.skip;

maybeDescribe('apply migrations (integration)', () => {
  let rootDir = '';
  let tableName = '';
  let migrationOneId = '';
  let migrationTwoId = '';

  beforeAll(async () => {
    const token = Math.random().toString(36).slice(2, 8);
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'oxe-migrate-apply-'));
    const migrationsDir = path.join(rootDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    tableName = `apply_test_${token}`;
    migrationOneId = `0001_${token}_create.sql`;
    migrationTwoId = `0002_${token}_alter.sql`;

    await writeFile(
      path.join(migrationsDir, migrationOneId),
      `CREATE TABLE "${tableName}" ("id" uuid PRIMARY KEY);`,
      'utf8',
    );
    await writeFile(
      path.join(migrationsDir, migrationTwoId),
      `ALTER TABLE "${tableName}" ADD COLUMN "name" text;`,
      'utf8',
    );
  });

  afterAll(async () => {
    if (databaseUrl) {
      const client = await connectPostgres({ connectionString: databaseUrl });
      try {
        await client.query(`DROP TABLE IF EXISTS "${tableName}";`);
      } finally {
        await client.end();
      }
    }

    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('applies pending migrations and records tracking status', async () => {
    const first = await applyMigrations({
      rootDir,
      connectionString: databaseUrl,
    });
    expect(first.appliedCount).toBe(2);
    expect(first.applied.map((entry) => entry.id)).toEqual([migrationOneId, migrationTwoId]);

    const second = await applyMigrations({
      rootDir,
      connectionString: databaseUrl,
    });
    expect(second.appliedCount).toBe(0);
    expect(second.skipped.map((entry) => entry.id)).toEqual([migrationOneId, migrationTwoId]);

    const status = await getMigrationStatus({
      rootDir,
      connectionString: databaseUrl,
    });

    expect(status.pending).toHaveLength(0);
    expect(status.applied.some((entry) => entry.id === migrationOneId)).toBe(true);
    expect(status.applied.some((entry) => entry.id === migrationTwoId)).toBe(true);
  });
});
