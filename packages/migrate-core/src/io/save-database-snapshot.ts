import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { DatabaseSnapshot } from '../snapshot/types.js';
import { resolveMigrationPaths } from './paths.js';
import { stableJsonStringify } from './stable-json.js';
import type { SnapshotIoOptions } from './types.js';

export const saveDatabaseSnapshot = async (
  snapshot: DatabaseSnapshot,
  options: SnapshotIoOptions = {},
): Promise<string> => {
  const { snapshotPath } = resolveMigrationPaths(options);

  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, stableJsonStringify(snapshot), 'utf8');

  return snapshotPath;
};
