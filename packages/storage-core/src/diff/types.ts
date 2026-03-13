import type { StorageMigrationDiagnostic } from '../diagnostics/types.js';
import type { StorageBucketSnapshot, StorageSnapshot } from '../snapshot/types.js';

export interface BucketCreatedChange {
  bucketName: string;
  next: StorageBucketSnapshot;
}

export interface BucketRemovedChange {
  bucketName: string;
  previous: StorageBucketSnapshot;
}

export interface BucketMetadataChangedChange {
  bucketName: string;
  previous: StorageBucketSnapshot;
  next: StorageBucketSnapshot;
}

export interface StorageSnapshotDiff {
  previousSnapshot: StorageSnapshot | null;
  nextSnapshot: StorageSnapshot;
  changes: {
    bucketsCreated: BucketCreatedChange[];
    bucketsRemoved: BucketRemovedChange[];
    bucketsMetadataChanged: BucketMetadataChangedChange[];
  };
  diagnostics: StorageMigrationDiagnostic[];
  hasChanges: boolean;
}
