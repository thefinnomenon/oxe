import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { resolveMigrationPaths } from '../io/paths.js';
import type { MigrationFileEntry } from './types.js';

const MIGRATION_FILENAME_REGEX = /^(\d+)_([a-z0-9_-]+)\.sql$/;

const toChecksum = (sql: string): string => createHash('sha256').update(sql).digest('hex');

export const loadMigrationFiles = async (input: {
  rootDir?: string;
  migrationsDir?: string;
}): Promise<MigrationFileEntry[]> => {
  const paths = resolveMigrationPaths({
    rootDir: input.rootDir,
    migrationsDir: input.migrationsDir,
  });

  let entries: string[];
  try {
    entries = await readdir(paths.migrationsDir, { encoding: 'utf8' });
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

  const migrationEntries: MigrationFileEntry[] = [];
  for (const entry of entries) {
    const matched = entry.match(MIGRATION_FILENAME_REGEX);
    if (!matched) {
      continue;
    }

    const migrationPath = path.join(paths.migrationsDir, entry);
    const sql = await readFile(migrationPath, 'utf8');

    migrationEntries.push({
      id: entry,
      number: Number.parseInt(matched[1], 10),
      path: migrationPath,
      sql,
      checksum: toChecksum(sql),
    });
  }

  return migrationEntries.sort((left, right) => left.id.localeCompare(right.id));
};
