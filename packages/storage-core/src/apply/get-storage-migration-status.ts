import { loadStorageMigrationFiles } from '../io/load-storage-migration-files.js';
import { ensureMigrationTrackingTable, listAppliedMigrations } from '../tracking/queries.js';
import { connectPostgres } from './connect-postgres.js';
import type { PostgresConnectionOptions, StorageMigrationStatusResult } from './types.js';

export interface GetStorageMigrationStatusOptions extends PostgresConnectionOptions {
  rootDir?: string;
  migrationsDir?: string;
}

export const getStorageMigrationStatus = async (
  options: GetStorageMigrationStatusOptions = {},
): Promise<StorageMigrationStatusResult> => {
  const files = await loadStorageMigrationFiles({
    rootDir: options.rootDir,
    migrationsDir: options.migrationsDir,
  });

  const client = await connectPostgres(options);
  try {
    await ensureMigrationTrackingTable(client);
    const appliedAll = await listAppliedMigrations(client);
    const applied = appliedAll.filter((entry) => entry.id.endsWith('.storage.json'));
    const appliedIds = new Set(applied.map((entry) => entry.id));
    const fileIds = new Set(files.map((entry) => entry.id));

    return {
      files,
      applied,
      pending: files.filter((entry) => !appliedIds.has(entry.id)),
      extraAppliedInDatabase: applied.filter((entry) => !fileIds.has(entry.id)),
    };
  } finally {
    await client.end();
  }
};
