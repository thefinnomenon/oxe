import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveMigrationPaths } from './paths.js';
import { stableJsonStringify } from './stable-json.js';
import type { MigrationStatus, SnapshotIoOptions, WriteMigrationFilesOptions } from './types.js';

const MIGRATION_FILE_REGEX = /^(\d+)_([a-z0-9_-]+)\.sql$/;

const parseMigrationNumber = (filename: string): number | undefined => {
  const match = filename.match(MIGRATION_FILE_REGEX);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const byMigrationFileOrder = (left: string, right: string): number => {
  const leftNumber = parseMigrationNumber(left) ?? 0;
  const rightNumber = parseMigrationNumber(right) ?? 0;
  if (leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
};

export const loadMigrationStatus = async (
  options: SnapshotIoOptions | WriteMigrationFilesOptions = {},
): Promise<MigrationStatus | null> => {
  const { statusPath } = resolveMigrationPaths(options);

  try {
    const raw = await readFile(statusPath, 'utf8');
    return JSON.parse(raw) as MigrationStatus;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }

    throw error;
  }
};

export const saveMigrationStatus = async (
  status: MigrationStatus,
  options: SnapshotIoOptions | WriteMigrationFilesOptions = {},
): Promise<string> => {
  const { statusPath } = resolveMigrationPaths(options);
  await mkdir(path.dirname(statusPath), { recursive: true });
  await writeFile(statusPath, stableJsonStringify(status), 'utf8');
  return statusPath;
};

export const buildMigrationStatus = async (
  options: SnapshotIoOptions | WriteMigrationFilesOptions = {},
): Promise<MigrationStatus> => {
  const { migrationsDir, snapshotPath } = resolveMigrationPaths(options);
  let migrationFiles: string[] = [];

  try {
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    migrationFiles = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((entryName) => MIGRATION_FILE_REGEX.test(entryName))
      .sort(byMigrationFileOrder);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      migrationFiles = [];
    } else {
      throw error;
    }
  }

  const latestMigration =
    migrationFiles.length > 0 ? migrationFiles[migrationFiles.length - 1] : undefined;
  return {
    formatVersion: 1,
    updatedAt: new Date().toISOString(),
    latestMigration,
    latestMigrationNumber: latestMigration ? parseMigrationNumber(latestMigration) : undefined,
    migrationFiles,
    snapshotPath,
  };
};
