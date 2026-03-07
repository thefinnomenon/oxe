import path from 'node:path';

import type { SnapshotIoOptions, WriteMigrationFilesOptions } from './types.js';

export interface ResolvedMigrationPaths {
  rootDir: string;
  snapshotPath: string;
  migrationsDir: string;
}

export const resolveMigrationPaths = (
  options: SnapshotIoOptions | WriteMigrationFilesOptions = {},
): ResolvedMigrationPaths => {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  const snapshotPath = options.snapshotPath
    ? path.resolve(options.snapshotPath)
    : path.join(rootDir, '.oxe', 'db-snapshot.json');
  const migrationsDir =
    'migrationsDir' in options && options.migrationsDir
      ? path.resolve(options.migrationsDir)
      : path.join(rootDir, 'migrations');

  return {
    rootDir,
    snapshotPath,
    migrationsDir,
  };
};
