import { createStorageMigrationDiagnostic } from '../diagnostics/helpers.js';
import type { StorageSnapshotDiff } from './types.js';
import type { StorageSnapshot } from '../snapshot/types.js';

const sortBy = <TValue>(values: TValue[], selector: (value: TValue) => string): TValue[] =>
  [...values].sort((a, b) => selector(a).localeCompare(selector(b)));

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

export const diffStorageSnapshots = (
  previousSnapshot: StorageSnapshot | null,
  nextSnapshot: StorageSnapshot,
): StorageSnapshotDiff => {
  const diagnostics = [] as StorageSnapshotDiff['diagnostics'];

  if (!previousSnapshot) {
    const bucketsCreated = sortBy(
      Object.entries(nextSnapshot.buckets).map(([bucketName, next]) => ({ bucketName, next })),
      (change) => change.bucketName,
    );

    return {
      previousSnapshot,
      nextSnapshot,
      changes: {
        bucketsCreated,
        bucketsRemoved: [],
        bucketsMetadataChanged: [],
      },
      diagnostics,
      hasChanges: bucketsCreated.length > 0,
    };
  }

  const previousBuckets = previousSnapshot.buckets;
  const nextBuckets = nextSnapshot.buckets;

  const bucketsCreated = sortBy(
    Object.keys(nextBuckets)
      .filter((bucketName) => !previousBuckets[bucketName])
      .map((bucketName) => ({
        bucketName,
        next: nextBuckets[bucketName],
      })),
    (change) => change.bucketName,
  );

  const bucketsRemoved = sortBy(
    Object.keys(previousBuckets)
      .filter((bucketName) => !nextBuckets[bucketName])
      .map((bucketName) => ({
        bucketName,
        previous: previousBuckets[bucketName],
      })),
    (change) => change.bucketName,
  );

  const bucketsMetadataChanged = sortBy(
    Object.keys(nextBuckets)
      .filter((bucketName) => Boolean(previousBuckets[bucketName]))
      .flatMap((bucketName) => {
        const previous = previousBuckets[bucketName];
        const next = nextBuckets[bucketName];
        const sameProviderBucketName = previous.providerBucketName === next.providerBucketName;
        const sameMetadata = stableSerialize(previous.metadata) === stableSerialize(next.metadata);

        if (sameProviderBucketName && sameMetadata) {
          return [];
        }

        if (!sameProviderBucketName) {
          diagnostics.push(
            createStorageMigrationDiagnostic({
              code: 'BUCKET_PROVIDER_NAME_CHANGE',
              severity: 'warning',
              message: `Bucket "${bucketName}" changed provider bucket name from "${previous.providerBucketName}" to "${next.providerBucketName}". v1 treats this as a bucket metadata migration concern and may require manual review.`,
              source: {
                bucket: bucketName,
              },
            }),
          );
        }

        return [
          {
            bucketName,
            previous,
            next,
          },
        ];
      }),
    (change) => change.bucketName,
  );

  const hasChanges =
    bucketsCreated.length > 0 ||
    bucketsRemoved.length > 0 ||
    bucketsMetadataChanged.length > 0 ||
    diagnostics.length > 0;

  return {
    previousSnapshot,
    nextSnapshot,
    changes: {
      bucketsCreated,
      bucketsRemoved,
      bucketsMetadataChanged,
    },
    diagnostics,
    hasChanges,
  };
};
