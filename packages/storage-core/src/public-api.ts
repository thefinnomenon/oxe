export {
  STORAGE_SNAPSHOT_FORMAT_VERSION,
  buildProviderBucketName,
  buildStorageSnapshot,
  type BuildStorageSnapshotOptions,
  type StorageBucketSnapshot,
  type StorageSnapshot,
  type StorageSnapshotNaming,
} from './snapshot/index.js';

export {
  diffStorageSnapshots,
  type BucketCreatedChange,
  type BucketMetadataChangedChange,
  type BucketRemovedChange,
  type StorageSnapshotDiff,
} from './diff/index.js';

export {
  collectBucketRenameHints,
  detectAmbiguousBucketChanges,
  generateStorageMigrationPlan,
  orderStorageMigrationOperations,
  parseStorageMigrationArtifact,
  resolveBucketAmbiguities,
  serializeStorageMigrationPlan,
  type AmbiguousBucketChange,
  type BucketAmbiguityCandidate,
  type BucketAmbiguityResolution,
  type BucketAmbiguityResolutions,
  type BucketRenameHint,
  type CollectBucketRenameHintsResult,
  type CreateBucketOperation,
  type DeleteBucketOperation,
  type GenerateStorageMigrationPlanOptions,
  type RenameBucketOperation,
  type ResolvedBucketRenameHint,
  type StorageMigrationOperation,
  type StorageMigrationPlan,
  type StorageMigrationRenameHints,
  type WarnBucketMetadataChangeOperation,
} from './operations/index.js';

export {
  applyStorageMigrations,
  connectPostgres,
  getStorageMigrationStatus,
  type ApplyStorageMigrationsOptions,
  type ApplyStorageMigrationsResult,
  type GetStorageMigrationStatusOptions,
  type PostgresConnectionOptions,
  type StorageMigrationStatusResult,
} from './apply/index.js';

export {
  loadStorageMigrationFiles,
  loadStorageSnapshot,
  resolveStoragePaths,
  saveStorageSnapshot,
  stableJsonStringify,
  writeStorageMigrationFile,
  type ResolvedStoragePaths,
  type StorageIoOptions,
  type StorageMigrationArtifactFile,
  type WriteStorageMigrationInput,
  type WriteStorageMigrationOptions,
  type WriteStorageMigrationResult,
} from './io/index.js';

export {
  S3CompatibleStorageProvider,
  createS3CompatibleProviderFromEnv,
  readS3CompatibleProviderConfigFromEnv,
  type S3CompatibleProviderConfig,
} from './s3-compatible/index.js';

export {
  type CreateBucketOptions,
  type DeleteBucketOptions,
  type StorageBucketDescriptor,
  type StorageProvider,
} from './provider/index.js';

export {
  createStorageMigrationDiagnostic,
  type StorageMigrationDiagnostic,
  type StorageMigrationDiagnosticSeverity,
  type StorageMigrationDiagnosticSource,
} from './diagnostics/index.js';

export {
  InteractiveStoragePromptAdapter,
  TestStoragePromptAdapter,
  type StoragePromptAdapter,
  type TestStoragePromptAdapterInput,
} from './prompts/index.js';
