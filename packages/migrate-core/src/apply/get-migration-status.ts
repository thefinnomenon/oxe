import { resolveMigrationPaths } from '../io/paths.js';
import { ensureMigrationTrackingTable, listAppliedMigrations } from '../tracking/index.js';
import { connectPostgres } from './connect-postgres.js';
import { loadMigrationFiles } from './load-migration-files.js';
import type { MigrationStatusResult, PostgresConnectionOptions } from './types.js';

export interface GetMigrationStatusOptions extends PostgresConnectionOptions {
  rootDir?: string;
  migrationsDir?: string;
}

export const getMigrationStatus = async (
  options: GetMigrationStatusOptions = {},
): Promise<MigrationStatusResult> => {
  const paths = resolveMigrationPaths({
    rootDir: options.rootDir,
    migrationsDir: options.migrationsDir,
  });
  const files = await loadMigrationFiles({
    rootDir: options.rootDir,
    migrationsDir: options.migrationsDir,
  });

  const client = await connectPostgres(options);
  try {
    await ensureMigrationTrackingTable(client);
    const applied = (await listAppliedMigrations(client)).filter((entry) =>
      entry.id.endsWith('.sql'),
    );
    const appliedIds = new Set(applied.map((entry) => entry.id));
    const fileIds = new Set(files.map((entry) => entry.id));

    return {
      migrationsDir: paths.migrationsDir,
      files,
      applied,
      pending: files.filter((entry) => !appliedIds.has(entry.id)),
      extraAppliedInDatabase: applied.filter((entry) => !fileIds.has(entry.id)),
    };
  } finally {
    await client.end();
  }
};
