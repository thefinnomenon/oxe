import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { renderMigrationSql } from '../sql/render-migration-sql.js';
import type { WriteMigrationFilesInput, WriteMigrationFilesResult } from './types.js';
import { buildMigrationStatus, saveMigrationStatus } from './migration-status.js';
import { resolveMigrationPaths } from './paths.js';
import { saveDatabaseSnapshot } from './save-database-snapshot.js';

const MIGRATION_FILE_REGEX = /^(\d+)_([a-z0-9_-]+)\.sql$/;

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
};

const getNextMigrationNumber = async (migrationsDir: string): Promise<number> => {
  try {
    const entries = await readdir(migrationsDir, { withFileTypes: true });

    const max = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .map((entryName) => entryName.match(MIGRATION_FILE_REGEX))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => Number.parseInt(match[1], 10))
      .filter((value) => Number.isFinite(value))
      .reduce((currentMax, value) => Math.max(currentMax, value), 0);

    return max + 1;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return 1;
    }

    throw error;
  }
};

export const writeMigrationFiles = async (
  input: WriteMigrationFilesInput,
): Promise<WriteMigrationFilesResult> => {
  const options = input.options ?? {};
  const paths = resolveMigrationPaths(options);

  if (input.plan.blocked && !options.allowBlockedPlan) {
    throw new Error('Migration plan is blocked. Set allowBlockedPlan=true to write files anyway.');
  }

  const snapshotPath = await saveDatabaseSnapshot(input.nextSnapshot, {
    rootDir: paths.rootDir,
    snapshotPath: paths.snapshotPath,
  });

  if (input.plan.operations.length === 0) {
    const status = await buildMigrationStatus({
      rootDir: paths.rootDir,
      snapshotPath: paths.snapshotPath,
      statusPath: paths.statusPath,
      migrationsDir: paths.migrationsDir,
    });
    const statusPath = await saveMigrationStatus(status, {
      rootDir: paths.rootDir,
      statusPath: paths.statusPath,
    });
    return {
      snapshotPath,
      statusPath,
      wroteMigration: false,
    };
  }

  await mkdir(paths.migrationsDir, { recursive: true });

  const migrationNumber = await getNextMigrationNumber(paths.migrationsDir);
  const paddedMigrationNumber = String(migrationNumber).padStart(4, '0');
  const migrationSlug = slugify(options.migrationName ?? 'migration') || 'migration';
  const migrationFilename = `${paddedMigrationNumber}_${migrationSlug}.sql`;
  const migrationPath = path.join(paths.migrationsDir, migrationFilename);
  const sql = input.sql ?? renderMigrationSql(input.plan, { abortOnBlockedPlan: false });

  await writeFile(migrationPath, sql, 'utf8');
  const status = await buildMigrationStatus({
    rootDir: paths.rootDir,
    snapshotPath: paths.snapshotPath,
    statusPath: paths.statusPath,
    migrationsDir: paths.migrationsDir,
  });
  const statusPath = await saveMigrationStatus(status, {
    rootDir: paths.rootDir,
    statusPath: paths.statusPath,
  });

  return {
    migrationPath,
    snapshotPath,
    statusPath,
    wroteMigration: true,
    migrationNumber,
  };
};
