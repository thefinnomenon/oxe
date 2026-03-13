export {
  buildDatabaseSnapshot,
  type DatabaseColumnDefault,
  type DatabaseColumnSnapshot,
  type DatabaseEnumSnapshot,
  type DatabaseForeignKeySnapshot,
  type DatabaseIndexSnapshot,
  type DatabaseOnDeleteAction,
  type DatabasePrimaryKeySnapshot,
  DATABASE_SNAPSHOT_FORMAT_VERSION,
  type DatabaseSnapshot,
  type DatabaseTableSnapshot,
  type DatabaseUniqueConstraintSnapshot,
} from './snapshot/index.js';

export {
  diffDatabaseSnapshots,
  type ColumnAddedChange,
  type ColumnDefaultChangedChange,
  type ColumnNullabilityChangedChange,
  type ColumnRemovedChange,
  type ColumnTypeChangedChange,
  type DatabaseSnapshotDiff,
  type EnumCreatedChange,
  type EnumRemovedChange,
  type EnumValuesAppendedChange,
  type ForeignKeyAddedChange,
  type ForeignKeyOnDeleteChangedChange,
  type ForeignKeyRemovedChange,
  type IndexAddedChange,
  type IndexRemovedChange,
  type TableCreatedChange,
  type TableRemovedChange,
  type UniqueAddedChange,
  type UniqueRemovedChange,
} from './diff/index.js';

export {
  detectAmbiguousChanges,
  type AmbiguityCandidateScore,
  type AmbiguousColumnCandidate,
  type AmbiguousColumnChange,
  type AmbiguousTableCandidate,
  type AmbiguousTableChange,
  type DetectedAmbiguities,
} from './ambiguity/index.js';

export {
  createMigrationPreview,
  collectRenameHints,
  generateMigrationPlan,
  orderMigrationOperations,
  planMigrationWithAmbiguityResolution,
  type CreateMigrationPreviewOptions,
  type CollectRenameHintsResult,
  type MigrationPreview,
  type AddColumnOperation,
  type AddForeignKeyOperation,
  type AddIndexOperation,
  type AddUniqueOperation,
  type AlterColumnDefaultOperation,
  type AlterColumnNullabilityOperation,
  type AlterColumnTypeOperation,
  type AppendEnumValueOperation,
  type CreateEnumOperation,
  type CreateTableOperation,
  type DropColumnOperation,
  type DropEnumOperation,
  type DropForeignKeyOperation,
  type DropIndexOperation,
  type MigrationRenameHints,
  type ResolvedColumnRenameHint,
  type ResolvedTableRenameHint,
  type PlanMigrationWithAmbiguityResolutionOptions,
  type PlanMigrationWithAmbiguityResolutionResult,
  type DropTableOperation,
  type DropUniqueOperation,
  type GenerateMigrationPlanOptions,
  type MigrationOperation,
  type MigrationPlan,
  type RenameColumnOperation,
  type RenameTableOperation,
} from './operations/index.js';

export {
  resolveAmbiguities,
  type AmbiguityResolutions,
  type ColumnAmbiguityResolution,
  type ResolveAmbiguitiesOptions,
  type ResolveAmbiguitiesResult,
  type TableAmbiguityResolution,
} from './resolution/index.js';

export {
  InteractivePromptAdapter,
  TestPromptAdapter,
  type PromptAdapter,
  type TestPromptAdapterInput,
} from './prompts/index.js';

export { renderMigrationSql, type RenderMigrationSqlOptions } from './sql/index.js';

export {
  buildMigrationStatus,
  loadDatabaseSnapshot,
  loadMigrationStatus,
  saveMigrationStatus,
  saveDatabaseSnapshot,
  writeMigrationFiles,
  type MigrationStatus,
  type SnapshotIoOptions,
  type WriteMigrationFilesInput,
  type WriteMigrationFilesOptions,
  type WriteMigrationFilesResult,
} from './io/index.js';

export {
  applyMigrations,
  connectPostgres,
  getMigrationStatus,
  loadMigrationFiles,
  type MigrationApplyOptions,
  type MigrationApplyResult,
  type MigrationFileEntry,
  type MigrationStatusResult,
  type PostgresConnectionOptions,
} from './apply/index.js';

export {
  OXE_MIGRATIONS_TABLE,
  ensureMigrationTrackingTable,
  listAppliedMigrations,
  recordAppliedMigration,
  type AppliedMigrationRecord,
  type RecordAppliedMigrationInput,
} from './tracking/index.js';

export {
  introspectDatabaseSnapshot,
  type IntrospectDatabaseSnapshotOptions,
} from './introspection/index.js';

export {
  detectDatabaseDrift,
  detectDatabaseDriftFromPostgres,
  type DatabaseDriftResult,
  type DriftSummary,
} from './drift/index.js';

export {
  createMigrationDiagnostic,
  type MigrationDiagnostic,
  type MigrationDiagnosticSeverity,
  type MigrationDiagnosticSource,
} from './diagnostics/index.js';
