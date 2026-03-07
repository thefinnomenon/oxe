import type { MigrationDiagnostic } from '../diagnostics/types.js';
import type {
  DatabaseColumnSnapshot,
  DatabaseEnumSnapshot,
  DatabaseForeignKeySnapshot,
  DatabaseIndexSnapshot,
  DatabaseTableSnapshot,
  DatabaseUniqueConstraintSnapshot,
} from '../snapshot/types.js';

export interface CreateEnumOperation {
  kind: 'create_enum';
  enum: DatabaseEnumSnapshot;
}

export interface DropEnumOperation {
  kind: 'drop_enum';
  enum: DatabaseEnumSnapshot;
}

export interface AppendEnumValueOperation {
  kind: 'append_enum_value';
  enumName: string;
  enumDbName: string;
  value: string;
}

export interface CreateTableOperation {
  kind: 'create_table';
  table: DatabaseTableSnapshot;
}

export interface DropTableOperation {
  kind: 'drop_table';
  table: DatabaseTableSnapshot;
}

export interface AddColumnOperation {
  kind: 'add_column';
  tableName: string;
  column: DatabaseColumnSnapshot;
}

export interface DropColumnOperation {
  kind: 'drop_column';
  tableName: string;
  column: DatabaseColumnSnapshot;
}

export interface AlterColumnTypeOperation {
  kind: 'alter_column_type';
  tableName: string;
  columnName: string;
  previous: DatabaseColumnSnapshot;
  next: DatabaseColumnSnapshot;
}

export interface AlterColumnNullabilityOperation {
  kind: 'alter_column_nullability';
  tableName: string;
  columnName: string;
  nullable: boolean;
}

export interface AlterColumnDefaultOperation {
  kind: 'alter_column_default';
  tableName: string;
  columnName: string;
  default: DatabaseColumnSnapshot['default'];
  column: DatabaseColumnSnapshot;
}

export interface AddIndexOperation {
  kind: 'add_index';
  tableName: string;
  index: DatabaseIndexSnapshot;
}

export interface DropIndexOperation {
  kind: 'drop_index';
  tableName: string;
  index: DatabaseIndexSnapshot;
}

export interface AddUniqueOperation {
  kind: 'add_unique';
  tableName: string;
  unique: DatabaseUniqueConstraintSnapshot;
}

export interface DropUniqueOperation {
  kind: 'drop_unique';
  tableName: string;
  unique: DatabaseUniqueConstraintSnapshot;
}

export interface AddForeignKeyOperation {
  kind: 'add_foreign_key';
  tableName: string;
  foreignKey: DatabaseForeignKeySnapshot;
}

export interface DropForeignKeyOperation {
  kind: 'drop_foreign_key';
  tableName: string;
  foreignKey: DatabaseForeignKeySnapshot;
}

export type MigrationOperation =
  | CreateEnumOperation
  | DropEnumOperation
  | AppendEnumValueOperation
  | CreateTableOperation
  | DropTableOperation
  | AddColumnOperation
  | DropColumnOperation
  | AlterColumnTypeOperation
  | AlterColumnNullabilityOperation
  | AlterColumnDefaultOperation
  | AddIndexOperation
  | DropIndexOperation
  | AddUniqueOperation
  | DropUniqueOperation
  | AddForeignKeyOperation
  | DropForeignKeyOperation;

export interface GenerateMigrationPlanOptions {
  allowDestructive?: boolean;
}

export interface MigrationPlan {
  operations: MigrationOperation[];
  diagnostics: MigrationDiagnostic[];
  blocked: boolean;
}
