import {
  ensureMigrationTrackingTable,
  listAppliedMigrations,
  recordAppliedMigration,
} from '../tracking/index.js';
import { connectPostgres } from './connect-postgres.js';
import { loadMigrationFiles } from './load-migration-files.js';
import type { MigrationApplyOptions, MigrationApplyResult } from './types.js';

const hasExplicitTransactionStatements = (sql: string): boolean => {
  return /^\s*begin\s*;/im.test(sql) && /^\s*commit\s*;/im.test(sql);
};

export const applyMigrations = async (
  options: MigrationApplyOptions = {},
): Promise<MigrationApplyResult> => {
  const client = await connectPostgres(options);
  try {
    await ensureMigrationTrackingTable(client);
    const files = await loadMigrationFiles({
      rootDir: options.rootDir,
      migrationsDir: options.migrationsDir,
    });
    const appliedRecords = await listAppliedMigrations(client);
    const appliedById = new Map(appliedRecords.map((record) => [record.id, record]));
    const skipped = [] as MigrationApplyResult['skipped'];
    const pending = [] as typeof files;

    for (const file of files) {
      const alreadyApplied = appliedById.get(file.id);
      if (!alreadyApplied) {
        pending.push(file);
        continue;
      }

      if (alreadyApplied.checksum !== file.checksum) {
        throw new Error(
          `Checksum mismatch for already-applied migration "${file.id}". Database checksum ${alreadyApplied.checksum} does not match local ${file.checksum}.`,
        );
      }

      skipped.push(file);
    }

    const applied: MigrationApplyResult['applied'] = [];
    for (const file of pending) {
      const startedAt = Date.now();
      const hasTx = hasExplicitTransactionStatements(file.sql);

      if (hasTx) {
        await client.query(file.sql);
        await recordAppliedMigration(client, {
          id: file.id,
          checksum: file.checksum,
          executionMs: Date.now() - startedAt,
        });
      } else {
        await client.query('BEGIN;');
        try {
          await client.query(file.sql);
          await recordAppliedMigration(client, {
            id: file.id,
            checksum: file.checksum,
            executionMs: Date.now() - startedAt,
          });
          await client.query('COMMIT;');
        } catch (error) {
          await client.query('ROLLBACK;');
          throw error;
        }
      }

      applied.push(file);
    }

    return {
      applied,
      skipped,
      pendingCount: pending.length,
      appliedCount: applied.length,
    };
  } finally {
    await client.end();
  }
};
