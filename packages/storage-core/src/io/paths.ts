import path from 'node:path';

import type { StorageIoOptions } from './types.js';

export interface ResolvedStoragePaths {
  rootDir: string;
  storageSnapshotPath: string;
  migrationsDir: string;
}

export const resolveStoragePaths = (options: StorageIoOptions = {}): ResolvedStoragePaths => {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  return {
    rootDir,
    storageSnapshotPath: options.storageSnapshotPath
      ? path.resolve(options.storageSnapshotPath)
      : path.join(rootDir, '.oxe', 'storage-snapshot.json'),
    migrationsDir: options.migrationsDir
      ? path.resolve(options.migrationsDir)
      : path.join(rootDir, 'migrations'),
  };
};
