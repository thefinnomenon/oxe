import type { NormalizedBucketMetadata } from '@oxe/schema-core';

export const STORAGE_SNAPSHOT_FORMAT_VERSION = 1;

export interface StorageBucketSnapshot {
  /** Logical schema bucket declaration name. */
  logicalName: string;
  /** Physical provider-visible bucket name. */
  providerBucketName: string;
  /** Optional previous logical bucket name for rename planning. */
  renameFrom?: string;
  /** Source file path from schema graph provenance. */
  sourcePath: string;
  /** Normalized bucket metadata authored in schema. */
  metadata: NormalizedBucketMetadata;
}

export interface StorageSnapshotNaming {
  bucketPrefix?: string;
}

export interface StorageSnapshot {
  formatVersion: number;
  generatedFromRootDir: string;
  naming: StorageSnapshotNaming;
  buckets: Record<string, StorageBucketSnapshot>;
}

export interface BuildStorageSnapshotOptions {
  bucketPrefix?: string;
}
