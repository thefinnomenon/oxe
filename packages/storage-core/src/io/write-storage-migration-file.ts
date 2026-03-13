import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { serializeStorageMigrationPlan } from '../operations/serialize-storage-migration-plan.js';
import type { WriteStorageMigrationInput, WriteStorageMigrationResult } from './types.js';
import { resolveStoragePaths } from './paths.js';
import { saveStorageSnapshot } from './save-storage-snapshot.js';

const SQL_MIGRATION_FILE_REGEX = /^(\d+)_([a-z0-9_-]+)\.sql$/;
const STORAGE_MIGRATION_FILE_REGEX = /^(\d+)_([a-z0-9_-]+)\.storage\.json$/;

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

const getNextMigrationNumber = async (migrationsDir: string): Promise<number> => {
  try {
    const entries = await readdir(migrationsDir, { encoding: 'utf8' });

    const maxNumber = entries
      .map(
        (entry) =>
          entry.match(SQL_MIGRATION_FILE_REGEX) ?? entry.match(STORAGE_MIGRATION_FILE_REGEX),
      )
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => Number.parseInt(match[1], 10))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 0);

    return maxNumber + 1;
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

export const writeStorageMigrationFile = async (
  input: WriteStorageMigrationInput,
): Promise<WriteStorageMigrationResult> => {
  const options = input.options ?? {};
  const paths = resolveStoragePaths(options);

  if (input.plan.blocked && !options.allowBlockedPlan) {
    throw new Error(
      'Storage migration plan is blocked. Set allowBlockedPlan=true to write files anyway.',
    );
  }

  const storageSnapshotPath = await saveStorageSnapshot(input.nextSnapshot, {
    rootDir: paths.rootDir,
    storageSnapshotPath: paths.storageSnapshotPath,
  });

  if (input.plan.operations.length === 0) {
    return {
      storageSnapshotPath,
      wroteMigration: false,
    };
  }

  await mkdir(paths.migrationsDir, { recursive: true });

  const migrationNumber =
    options.migrationNumber ?? (await getNextMigrationNumber(paths.migrationsDir));
  const paddedNumber = String(migrationNumber).padStart(4, '0');
  const slug = slugify(options.migrationName ?? 'migration') || 'migration';
  const migrationFilename = `${paddedNumber}_${slug}.storage.json`;
  const migrationPath = path.join(paths.migrationsDir, migrationFilename);

  await writeFile(migrationPath, serializeStorageMigrationPlan(input.plan), 'utf8');

  return {
    storageSnapshotPath,
    migrationPath,
    migrationNumber,
    wroteMigration: true,
  };
};
