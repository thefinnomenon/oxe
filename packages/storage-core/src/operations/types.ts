import type { StorageMigrationDiagnostic } from '../diagnostics/types.js';
import type { StoragePromptAdapter } from '../prompts/types.js';
import type { StorageBucketSnapshot } from '../snapshot/types.js';
import type { BucketAmbiguityResolutions } from './resolve-bucket-ambiguities.js';

export interface CreateBucketOperation {
  kind: 'create_bucket';
  bucketName: string;
  providerBucketName: string;
  bucket: StorageBucketSnapshot;
}

export interface DeleteBucketOperation {
  kind: 'delete_bucket';
  bucketName: string;
  providerBucketName: string;
  bucket: StorageBucketSnapshot;
}

export interface RenameBucketOperation {
  kind: 'rename_bucket';
  fromBucketName: string;
  toBucketName: string;
  fromProviderBucketName: string;
  toProviderBucketName: string;
  strategy: 'create_new_keep_old';
}

export interface WarnBucketMetadataChangeOperation {
  kind: 'warn_bucket_metadata_change';
  bucketName: string;
  previous: StorageBucketSnapshot;
  next: StorageBucketSnapshot;
}

export type StorageMigrationOperation =
  | CreateBucketOperation
  | DeleteBucketOperation
  | RenameBucketOperation
  | WarnBucketMetadataChangeOperation;

export interface BucketRenameHint {
  fromBucketName: string;
  toBucketName: string;
}

export interface StorageMigrationRenameHints {
  bucketRenames?: BucketRenameHint[];
}

export interface GenerateStorageMigrationPlanOptions {
  allowDestructive?: boolean;
  nonInteractive?: boolean;
  renameHints?: StorageMigrationRenameHints;
  promptAdapter?: StoragePromptAdapter;
  providedResolutions?: Partial<BucketAmbiguityResolutions>;
}

export interface StorageMigrationPlan {
  operations: StorageMigrationOperation[];
  diagnostics: StorageMigrationDiagnostic[];
  blocked: boolean;
}
