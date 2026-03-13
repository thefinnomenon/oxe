import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { StorageSnapshot } from '../snapshot/types.js';
import { resolveStoragePaths } from './paths.js';
import { stableJsonStringify } from './stable-json.js';
import type { StorageIoOptions } from './types.js';

export const saveStorageSnapshot = async (
  snapshot: StorageSnapshot,
  options: StorageIoOptions = {},
): Promise<string> => {
  const { storageSnapshotPath } = resolveStoragePaths(options);
  await mkdir(path.dirname(storageSnapshotPath), { recursive: true });
  await writeFile(storageSnapshotPath, stableJsonStringify(snapshot), 'utf8');
  return storageSnapshotPath;
};
