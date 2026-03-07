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
  generateMigrationPlan,
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
  type DropTableOperation,
  type DropUniqueOperation,
  type GenerateMigrationPlanOptions,
  type MigrationOperation,
  type MigrationPlan,
} from './operations/index.js';

export { renderMigrationSql, type RenderMigrationSqlOptions } from './sql/index.js';

export {
  loadDatabaseSnapshot,
  saveDatabaseSnapshot,
  writeMigrationFiles,
  type SnapshotIoOptions,
  type WriteMigrationFilesInput,
  type WriteMigrationFilesOptions,
  type WriteMigrationFilesResult,
} from './io/index.js';

export {
  createMigrationDiagnostic,
  type MigrationDiagnostic,
  type MigrationDiagnosticSeverity,
  type MigrationDiagnosticSource,
} from './diagnostics/index.js';
