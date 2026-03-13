import { createStorageMigrationDiagnostic } from '../diagnostics/helpers.js';
import type { StorageSnapshotDiff } from '../diff/types.js';
import { collectBucketRenameHints } from './collect-bucket-rename-hints.js';
import { detectAmbiguousBucketChanges } from './bucket-ambiguity.js';
import { orderStorageMigrationOperations } from './order-storage-migration-operations.js';
import { resolveBucketAmbiguities } from './resolve-bucket-ambiguities.js';
import type {
  GenerateStorageMigrationPlanOptions,
  StorageMigrationOperation,
  StorageMigrationPlan,
} from './types.js';

export const generateStorageMigrationPlan = async (
  diff: StorageSnapshotDiff,
  options: GenerateStorageMigrationPlanOptions = {},
): Promise<StorageMigrationPlan> => {
  const diagnostics = [...diff.diagnostics];

  const collectedHints = collectBucketRenameHints(diff, options.renameHints);
  diagnostics.push(...collectedHints.diagnostics);

  const ambiguities = detectAmbiguousBucketChanges(diff);
  const providedResolutions = {
    buckets: [
      ...collectedHints.bucketRenames.map((entry) => ({
        missingBucketName: entry.fromBucketName,
        decision: 'renamed' as const,
        targetBucketName: entry.toBucketName,
      })),
      ...(options.providedResolutions?.buckets ?? []),
    ],
  };

  const resolution = await resolveBucketAmbiguities(ambiguities, {
    promptAdapter: options.promptAdapter,
    nonInteractive: options.nonInteractive,
    providedResolutions,
  });

  diagnostics.push(...resolution.diagnostics);

  if (resolution.unresolvedCount > 0) {
    diagnostics.push(
      createStorageMigrationDiagnostic({
        code: 'PLAN_BLOCKED_UNRESOLVED_BUCKET_AMBIGUITY',
        severity: 'error',
        message:
          'Storage migration plan contains unresolved bucket rename-vs-delete ambiguities. Resolve them interactively or provide explicit hints/resolutions.',
      }),
    );

    return {
      operations: [],
      diagnostics,
      blocked: true,
    };
  }

  const consumedCreated = new Set<string>();
  const consumedRemoved = new Set<string>();
  const operations: StorageMigrationOperation[] = [];

  for (const resolutionEntry of resolution.resolutions.buckets) {
    if (resolutionEntry.decision !== 'renamed' || !resolutionEntry.targetBucketName) {
      continue;
    }

    const removed = diff.changes.bucketsRemoved.find(
      (entry) => entry.bucketName === resolutionEntry.missingBucketName,
    );
    const created = diff.changes.bucketsCreated.find(
      (entry) => entry.bucketName === resolutionEntry.targetBucketName,
    );

    if (!removed || !created) {
      diagnostics.push(
        createStorageMigrationDiagnostic({
          code: 'INVALID_BUCKET_RENAME_HINT',
          severity: 'error',
          message: `Invalid bucket rename resolution "${resolutionEntry.missingBucketName}" -> "${resolutionEntry.targetBucketName}". Expected matching removed/created buckets.`,
          source: {
            bucket: resolutionEntry.targetBucketName,
          },
        }),
      );
      continue;
    }

    consumedRemoved.add(removed.bucketName);
    consumedCreated.add(created.bucketName);
    operations.push({
      kind: 'rename_bucket',
      fromBucketName: removed.bucketName,
      toBucketName: created.bucketName,
      fromProviderBucketName: removed.previous.providerBucketName,
      toProviderBucketName: created.next.providerBucketName,
      strategy: 'create_new_keep_old',
    });
    diagnostics.push(
      createStorageMigrationDiagnostic({
        code: 'BUCKET_RENAME_CREATE_KEEP_OLD',
        severity: 'warning',
        message: `Bucket rename "${removed.bucketName}" -> "${created.bucketName}" will be applied as create-new-and-keep-old in v1. Object copy/deletion is not automatic.`,
        source: {
          bucket: created.bucketName,
        },
      }),
    );
  }

  for (const created of diff.changes.bucketsCreated) {
    if (consumedCreated.has(created.bucketName)) {
      continue;
    }

    operations.push({
      kind: 'create_bucket',
      bucketName: created.bucketName,
      providerBucketName: created.next.providerBucketName,
      bucket: created.next,
    });
  }

  for (const removed of diff.changes.bucketsRemoved) {
    if (consumedRemoved.has(removed.bucketName)) {
      continue;
    }

    operations.push({
      kind: 'delete_bucket',
      bucketName: removed.bucketName,
      providerBucketName: removed.previous.providerBucketName,
      bucket: removed.previous,
    });

    diagnostics.push(
      createStorageMigrationDiagnostic({
        code: 'DESTRUCTIVE_DELETE_BUCKET',
        severity: 'warning',
        message: `Bucket "${removed.bucketName}" will be deleted. Non-empty bucket deletion is blocked unless force is enabled at apply time.`,
        source: {
          bucket: removed.bucketName,
        },
      }),
    );
  }

  for (const changed of diff.changes.bucketsMetadataChanged) {
    operations.push({
      kind: 'warn_bucket_metadata_change',
      bucketName: changed.bucketName,
      previous: changed.previous,
      next: changed.next,
    });

    diagnostics.push(
      createStorageMigrationDiagnostic({
        code: 'BUCKET_METADATA_CHANGE_UNMANAGED',
        severity: 'warning',
        message: `Bucket "${changed.bucketName}" metadata changed. v1 records this change but does not enforce provider-specific bucket policy updates automatically.`,
        source: {
          bucket: changed.bucketName,
        },
      }),
    );
  }

  const blocked =
    !options.allowDestructive &&
    diagnostics.some(
      (entry) => entry.code.startsWith('DESTRUCTIVE_') || entry.severity === 'error',
    );

  if (blocked) {
    diagnostics.push(
      createStorageMigrationDiagnostic({
        code: 'PLAN_BLOCKED_REQUIRES_ALLOW_DESTRUCTIVE',
        severity: 'error',
        message:
          'Storage migration plan includes destructive/risky changes. Re-run with allowDestructive=true to generate intentionally.',
      }),
    );
  }

  return {
    operations: orderStorageMigrationOperations(operations),
    diagnostics,
    blocked,
  };
};
