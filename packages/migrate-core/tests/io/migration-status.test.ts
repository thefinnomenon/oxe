import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildMigrationStatus, loadMigrationStatus, saveMigrationStatus } from '../../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
  tempDirs.length = 0;
});

describe('migration status io', () => {
  it('builds and persists status deterministically from migrations directory', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'oxe-migrate-status-'));
    tempDirs.push(rootDir);
    await mkdir(path.join(rootDir, 'migrations'), { recursive: true });
    await writeFile(path.join(rootDir, 'migrations', '0002_second.sql'), '-- second', 'utf8');
    await writeFile(path.join(rootDir, 'migrations', '0001_first.sql'), '-- first', 'utf8');

    const status = await buildMigrationStatus({ rootDir });
    expect(status.migrationFiles).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(status.latestMigration).toBe('0002_second.sql');
    expect(status.latestMigrationNumber).toBe(2);

    const statusPath = await saveMigrationStatus(status, { rootDir });
    expect(statusPath).toContain('.oxe/migration-status.json');

    const loaded = await loadMigrationStatus({ rootDir });
    expect(loaded?.migrationFiles).toEqual(['0001_first.sql', '0002_second.sql']);
  });
});
