import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { resolveStoragePaths } from './paths.js';
import type { StorageIoOptions, StorageMigrationArtifactFile } from './types.js';

const STORAGE_MIGRATION_FILE_REGEX = /^(\d+)_([a-z0-9_-]+)\.storage\.json$/;

const toChecksum = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export const loadStorageMigrationFiles = async (
  options: StorageIoOptions = {},
): Promise<StorageMigrationArtifactFile[]> => {
  const { migrationsDir } = resolveStoragePaths(options);

  let entries: string[];
  try {
    entries = await readdir(migrationsDir, { encoding: 'utf8' });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return [];
    }

    throw error;
  }

  const files: StorageMigrationArtifactFile[] = [];
  for (const entry of entries) {
    const matched = entry.match(STORAGE_MIGRATION_FILE_REGEX);
    if (!matched) {
      continue;
    }

    const migrationPath = path.join(migrationsDir, entry);
    const raw = await readFile(migrationPath, 'utf8');
    files.push({
      id: entry,
      number: Number.parseInt(matched[1], 10),
      path: migrationPath,
      raw,
      checksum: toChecksum(raw),
    });
  }

  return files.sort((left, right) => left.id.localeCompare(right.id));
};
