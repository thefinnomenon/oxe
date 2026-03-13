import type { StorageMigrationPlan } from '../operations/types.js';
import type { StorageSnapshot } from '../snapshot/types.js';

export interface StorageIoOptions {
  rootDir?: string;
  storageSnapshotPath?: string;
  migrationsDir?: string;
}

export interface WriteStorageMigrationOptions extends StorageIoOptions {
  migrationName?: string;
  migrationNumber?: number;
  allowBlockedPlan?: boolean;
}

export interface WriteStorageMigrationInput {
  plan: StorageMigrationPlan;
  nextSnapshot: StorageSnapshot;
  options?: WriteStorageMigrationOptions;
}

export interface WriteStorageMigrationResult {
  storageSnapshotPath: string;
  migrationPath?: string;
  migrationNumber?: number;
  wroteMigration: boolean;
}

export interface StorageMigrationArtifactFile {
  id: string;
  number: number;
  path: string;
  checksum: string;
  raw: string;
}
