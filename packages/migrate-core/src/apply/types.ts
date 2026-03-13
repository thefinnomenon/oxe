import type { AppliedMigrationRecord } from '../tracking/types.js';

export interface PostgresConnectionOptions {
  /** Full Postgres connection URL. Falls back to DATABASE_URL when omitted. */
  connectionString?: string;
}

export interface MigrationFileEntry {
  id: string;
  number: number;
  path: string;
  sql: string;
  checksum: string;
}

export interface MigrationApplyOptions extends PostgresConnectionOptions {
  /** Repository/app root (defaults to cwd). */
  rootDir?: string;
  /** Override migrations directory. */
  migrationsDir?: string;
}

export interface MigrationApplyResult {
  applied: MigrationFileEntry[];
  skipped: MigrationFileEntry[];
  pendingCount: number;
  appliedCount: number;
}

export interface MigrationStatusResult {
  migrationsDir: string;
  files: MigrationFileEntry[];
  applied: AppliedMigrationRecord[];
  pending: MigrationFileEntry[];
  extraAppliedInDatabase: AppliedMigrationRecord[];
}
