import type { MigrationPlan } from '../operations/types.js';
import type { DatabaseSnapshot } from '../snapshot/types.js';

export interface SnapshotIoOptions {
  rootDir?: string;
  snapshotPath?: string;
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
  wroteMigration: boolean;
  migrationNumber?: number;
}
