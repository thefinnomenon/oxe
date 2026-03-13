import type { MigrationPlan } from '../operations/types.js';
import type { DatabaseSnapshot } from '../snapshot/types.js';

export interface SnapshotIoOptions {
  rootDir?: string;
  snapshotPath?: string;
  statusPath?: string;
}

export interface WriteMigrationFilesOptions extends SnapshotIoOptions {
  migrationsDir?: string;
  migrationName?: string;
  allowBlockedPlan?: boolean;
}

export interface WriteMigrationFilesInput {
  plan: MigrationPlan;
  nextSnapshot: DatabaseSnapshot;
  sql?: string;
  options?: WriteMigrationFilesOptions;
}

export interface WriteMigrationFilesResult {
  migrationPath?: string;
  snapshotPath: string;
  statusPath: string;
  wroteMigration: boolean;
  migrationNumber?: number;
}

export interface MigrationStatus {
  formatVersion: 1;
  updatedAt: string;
  latestMigration?: string;
  latestMigrationNumber?: number;
  migrationFiles: string[];
  snapshotPath: string;
}
