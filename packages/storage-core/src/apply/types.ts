import type { AppliedMigrationRecord } from '../tracking/types.js';
import type { StorageProvider } from '../provider/types.js';
import type { StorageMigrationArtifactFile } from '../io/types.js';

export interface PostgresConnectionOptions {
  connectionString?: string;
}

export interface ApplyStorageMigrationsOptions extends PostgresConnectionOptions {
  rootDir?: string;
  migrationsDir?: string;
  provider: StorageProvider;
  forceDeleteNonEmptyBuckets?: boolean;
}

export interface ApplyStorageMigrationsResult {
  applied: StorageMigrationArtifactFile[];
  skipped: StorageMigrationArtifactFile[];
  pendingCount: number;
  appliedCount: number;
}

export interface StorageMigrationStatusResult {
  files: StorageMigrationArtifactFile[];
  applied: AppliedMigrationRecord[];
  pending: StorageMigrationArtifactFile[];
  extraAppliedInDatabase: AppliedMigrationRecord[];
}
