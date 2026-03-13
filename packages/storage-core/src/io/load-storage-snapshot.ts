import { readFile } from 'node:fs/promises';

import type { StorageSnapshot } from '../snapshot/types.js';
import { resolveStoragePaths } from './paths.js';
import type { StorageIoOptions } from './types.js';

export const loadStorageSnapshot = async (
  options: StorageIoOptions = {},
): Promise<StorageSnapshot | null> => {
  const { storageSnapshotPath } = resolveStoragePaths(options);

  try {
    const raw = await readFile(storageSnapshotPath, 'utf8');
    return JSON.parse(raw) as StorageSnapshot;
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
