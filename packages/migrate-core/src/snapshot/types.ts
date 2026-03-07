export const DATABASE_SNAPSHOT_FORMAT_VERSION = 1;

export type DatabaseOnDeleteAction = 'CASCADE' | 'RESTRICT' | 'SET NULL';

export type DatabaseColumnDefault =
  | { kind: 'raw_sql'; sql: string }
  | { kind: 'literal'; value: unknown };

export interface DatabaseEnumSnapshot {
  name: string;
  dbName: string;
  values: string[];
  sourcePath: string;
}

export interface DatabaseColumnSnapshot {
  name: string;
  postgresType: string;
  enumDbName?: string;
  isArray: boolean;
  nullable: boolean;
  default?: DatabaseColumnDefault;
  isPrimaryKey: boolean;
  sourcePath: string;
  declaration: string;
  builtIn: boolean;
}

export interface DatabasePrimaryKeySnapshot {
  name: string;
  columns: string[];
}

export interface DatabaseIndexSnapshot {
  name: string;
  columns: string[];
}

export interface DatabaseUniqueConstraintSnapshot {
  name: string;
  columns: string[];
}

export interface DatabaseForeignKeySnapshot {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: DatabaseOnDeleteAction;
}

export interface DatabaseTableSnapshot {
  name: string;
  dbName: string;
  sourcePath: string;
  columns: Record<string, DatabaseColumnSnapshot>;
  primaryKey?: DatabasePrimaryKeySnapshot;
  indexes: Record<string, DatabaseIndexSnapshot>;
  uniqueConstraints: Record<string, DatabaseUniqueConstraintSnapshot>;
  foreignKeys: Record<string, DatabaseForeignKeySnapshot>;
}

export interface DatabaseSnapshot {
  formatVersion: number;
  generatedFromRootDir: string;
  enums: Record<string, DatabaseEnumSnapshot>;
  tables: Record<string, DatabaseTableSnapshot>;
}
