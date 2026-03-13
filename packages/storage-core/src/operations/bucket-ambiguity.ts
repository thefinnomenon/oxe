import type { StorageSnapshotDiff } from '../diff/types.js';
import type { StorageBucketSnapshot } from '../snapshot/types.js';

export interface BucketAmbiguityCandidate {
  bucketName: string;
  bucket: StorageBucketSnapshot;
  score: number;
}

export interface AmbiguousBucketChange {
  missingBucketName: string;
  missingBucket: StorageBucketSnapshot;
  candidates: BucketAmbiguityCandidate[];
}

const diceCoefficient = (left: string, right: string): number => {
  if (left === right) {
    return 1;
  }

  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const grams = (value: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };

  const leftGrams = grams(a);
  const rightGrams = grams(b);

  let overlap = 0;
  for (const [gram, leftCount] of leftGrams.entries()) {
    overlap += Math.min(leftCount, rightGrams.get(gram) ?? 0);
  }

  return (2 * overlap) / (a.length - 1 + (b.length - 1));
};

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

const metadataSimilarity = (left: StorageBucketSnapshot, right: StorageBucketSnapshot): number =>
  stableSerialize(left.metadata) === stableSerialize(right.metadata) ? 1 : 0;

export const detectAmbiguousBucketChanges = (
  diff: StorageSnapshotDiff,
): AmbiguousBucketChange[] => {
  if (diff.changes.bucketsRemoved.length === 0 || diff.changes.bucketsCreated.length === 0) {
    return [];
  }

  return diff.changes.bucketsRemoved
    .map((removed) => ({
      missingBucketName: removed.bucketName,
      missingBucket: removed.previous,
      candidates: diff.changes.bucketsCreated
        .map((created) => {
          const nameScore = diceCoefficient(removed.bucketName, created.bucketName);
          const metadataScore = metadataSimilarity(removed.previous, created.next);
          return {
            bucketName: created.bucketName,
            bucket: created.next,
            score: metadataScore * 0.7 + nameScore * 0.3,
          };
        })
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          return left.bucketName.localeCompare(right.bucketName);
        }),
    }))
    .sort((left, right) => left.missingBucketName.localeCompare(right.missingBucketName));
};
