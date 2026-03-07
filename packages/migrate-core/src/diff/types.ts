import type {
  DatabaseColumnSnapshot,
  DatabaseEnumSnapshot,
  DatabaseForeignKeySnapshot,
  DatabaseIndexSnapshot,
  DatabaseSnapshot,
  DatabaseTableSnapshot,
  DatabaseUniqueConstraintSnapshot,
} from '../snapshot/types.js';
import type { MigrationDiagnostic } from '../diagnostics/types.js';

export interface EnumCreatedChange {
  enumName: string;
  next: DatabaseEnumSnapshot;
}

export interface EnumRemovedChange {
  enumName: string;
  previous: DatabaseEnumSnapshot;
}

export interface EnumValuesAppendedChange {
  enumName: string;
  appendedValues: string[];
  previous: DatabaseEnumSnapshot;
  next: DatabaseEnumSnapshot;
}

export interface TableCreatedChange {
  tableName: string;
  next: DatabaseTableSnapshot;
}

export interface TableRemovedChange {
  tableName: string;
  previous: DatabaseTableSnapshot;
}

export interface ColumnAddedChange {
  tableName: string;
  columnName: string;
  next: DatabaseColumnSnapshot;
}

export interface ColumnRemovedChange {
  tableName: string;
  columnName: string;
  previous: DatabaseColumnSnapshot;
}

export interface ColumnTypeChangedChange {
  tableName: string;
  columnName: string;
  previous: DatabaseColumnSnapshot;
  next: DatabaseColumnSnapshot;
}

export interface ColumnNullabilityChangedChange {
  tableName: string;
  columnName: string;
  previousNullable: boolean;
  nextNullable: boolean;
}

export interface ColumnDefaultChangedChange {
  tableName: string;
  columnName: string;
  previous: DatabaseColumnSnapshot['default'];
  next: DatabaseColumnSnapshot['default'];
}

export interface IndexAddedChange {
  tableName: string;
  indexName: string;
  next: DatabaseIndexSnapshot;
}

export interface IndexRemovedChange {
  tableName: string;
  indexName: string;
  previous: DatabaseIndexSnapshot;
}

export interface UniqueAddedChange {
  tableName: string;
  uniqueName: string;
  next: DatabaseUniqueConstraintSnapshot;
}

export interface UniqueRemovedChange {
  tableName: string;
  uniqueName: string;
  previous: DatabaseUniqueConstraintSnapshot;
}

export interface ForeignKeyAddedChange {
  tableName: string;
  foreignKeyName: string;
  next: DatabaseForeignKeySnapshot;
}

export interface ForeignKeyRemovedChange {
  tableName: string;
  foreignKeyName: string;
  previous: DatabaseForeignKeySnapshot;
}

export interface ForeignKeyOnDeleteChangedChange {
  tableName: string;
  foreignKeyName: string;
  previousOnDelete: DatabaseForeignKeySnapshot['onDelete'];
  nextOnDelete: DatabaseForeignKeySnapshot['onDelete'];
  previous: DatabaseForeignKeySnapshot;
  next: DatabaseForeignKeySnapshot;
}

export interface DatabaseSnapshotDiff {
  previousSnapshot: DatabaseSnapshot | null;
  nextSnapshot: DatabaseSnapshot;
  changes: {
    enumsCreated: EnumCreatedChange[];
    enumsRemoved: EnumRemovedChange[];
    enumValuesAppended: EnumValuesAppendedChange[];
    tablesCreated: TableCreatedChange[];
    tablesRemoved: TableRemovedChange[];
    columnsAdded: ColumnAddedChange[];
    columnsRemoved: ColumnRemovedChange[];
    columnsTypeChanged: ColumnTypeChangedChange[];
    columnsNullabilityChanged: ColumnNullabilityChangedChange[];
    columnsDefaultChanged: ColumnDefaultChangedChange[];
    indexesAdded: IndexAddedChange[];
    indexesRemoved: IndexRemovedChange[];
    uniquesAdded: UniqueAddedChange[];
    uniquesRemoved: UniqueRemovedChange[];
    foreignKeysAdded: ForeignKeyAddedChange[];
    foreignKeysRemoved: ForeignKeyRemovedChange[];
    foreignKeysOnDeleteChanged: ForeignKeyOnDeleteChangedChange[];
  };
  diagnostics: MigrationDiagnostic[];
  hasChanges: boolean;
}
