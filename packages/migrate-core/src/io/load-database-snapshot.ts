import { readFile } from 'node:fs/promises';

import type { DatabaseSnapshot } from '../snapshot/types.js';
import { resolveMigrationPaths } from './paths.js';
import type { SnapshotIoOptions } from './types.js';

export const loadDatabaseSnapshot = async (
  options: SnapshotIoOptions = {},
): Promise<DatabaseSnapshot | null> => {
  const { snapshotPath } = resolveMigrationPaths(options);

  try {
    const raw = await readFile(snapshotPath, 'utf8');
    return JSON.parse(raw) as DatabaseSnapshot;
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
