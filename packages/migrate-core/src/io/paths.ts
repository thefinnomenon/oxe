import path from 'node:path';

import type { SnapshotIoOptions, WriteMigrationFilesOptions } from './types.js';

export interface ResolvedMigrationPaths {
  rootDir: string;
  snapshotPath: string;
  statusPath: string;
  migrationsDir: string;
}

export const resolveMigrationPaths = (
  options: SnapshotIoOptions | WriteMigrationFilesOptions = {},
): ResolvedMigrationPaths => {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  const snapshotPath = options.snapshotPath
    ? path.resolve(options.snapshotPath)
    : path.join(rootDir, '.oxe', 'db-snapshot.json');
  const statusPath = options.statusPath
    ? path.resolve(options.statusPath)
    : path.join(rootDir, '.oxe', 'migration-status.json');
  const migrationsDir =
    'migrationsDir' in options && options.migrationsDir
      ? path.resolve(options.migrationsDir)
      : path.join(rootDir, 'migrations');

  return {
    rootDir,
    snapshotPath,
    statusPath,
    migrationsDir,
  };
};
