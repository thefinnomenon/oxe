import { loadStorageMigrationFiles } from '../io/load-storage-migration-files.js';
import { parseStorageMigrationArtifact } from '../operations/serialize-storage-migration-plan.js';
import type { StorageMigrationOperation } from '../operations/types.js';
import {
  ensureMigrationTrackingTable,
  listAppliedMigrations,
  recordAppliedMigration,
} from '../tracking/queries.js';
import { connectPostgres } from './connect-postgres.js';
import type { ApplyStorageMigrationsOptions, ApplyStorageMigrationsResult } from './types.js';

export const applyStorageOperation = async (
  operation: StorageMigrationOperation,
  provider: ApplyStorageMigrationsOptions['provider'],
  forceDeleteNonEmptyBuckets: boolean,
): Promise<void> => {
  if (operation.kind === 'warn_bucket_metadata_change') {
    return;
  }

  if (operation.kind === 'create_bucket') {
    const exists = await provider.bucketExists(operation.providerBucketName);
    if (!exists) {
      await provider.createBucket({ name: operation.providerBucketName });
    }
    return;
  }

  if (operation.kind === 'rename_bucket') {
    const targetExists = await provider.bucketExists(operation.toProviderBucketName);
    if (!targetExists) {
      await provider.createBucket({ name: operation.toProviderBucketName });
    }
    return;
  }

  const exists = await provider.bucketExists(operation.providerBucketName);
  if (!exists) {
    return;
  }

  const isEmpty = await provider.isBucketEmpty(operation.providerBucketName);
  if (!isEmpty && !forceDeleteNonEmptyBuckets) {
    throw new Error(
      `Refusing to delete non-empty bucket "${operation.providerBucketName}". Re-run with forceDeleteNonEmptyBuckets=true to explicitly allow object deletion.`,
    );
  }

  if (!isEmpty && forceDeleteNonEmptyBuckets) {
    await provider.emptyBucket(operation.providerBucketName);
  }

  await provider.deleteBucket({ name: operation.providerBucketName });
};

export const applyStorageMigrations = async (
  options: ApplyStorageMigrationsOptions,
): Promise<ApplyStorageMigrationsResult> => {
  const files = await loadStorageMigrationFiles({
    rootDir: options.rootDir,
    migrationsDir: options.migrationsDir,
  });

  const client = await connectPostgres({ connectionString: options.connectionString });
  try {
    await ensureMigrationTrackingTable(client);
    const appliedRecords = await listAppliedMigrations(client);
    const appliedById = new Map(appliedRecords.map((entry) => [entry.id, entry]));

    const skipped: ApplyStorageMigrationsResult['skipped'] = [];
    const pending: typeof files = [];

    for (const file of files) {
      const alreadyApplied = appliedById.get(file.id);
      if (!alreadyApplied) {
        pending.push(file);
        continue;
      }

      if (alreadyApplied.checksum !== file.checksum) {
        throw new Error(
          `Checksum mismatch for already-applied storage migration "${file.id}". Database checksum ${alreadyApplied.checksum} does not match local ${file.checksum}.`,
        );
      }

      skipped.push(file);
    }

    const applied: ApplyStorageMigrationsResult['applied'] = [];
    for (const file of pending) {
      const startedAt = Date.now();
      const parsed = parseStorageMigrationArtifact(file.raw);
      for (const operation of parsed.operations) {
        await applyStorageOperation(
          operation,
          options.provider,
          options.forceDeleteNonEmptyBuckets ?? false,
        );
      }

      await recordAppliedMigration(client, {
        id: file.id,
        checksum: file.checksum,
        executionMs: Date.now() - startedAt,
      });
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
