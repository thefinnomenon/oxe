import { createMigrationDiagnostic } from '../diagnostics/index.js';
import type { DatabaseSnapshotDiff } from '../diff/types.js';
import type { GenerateMigrationPlanOptions, MigrationOperation, MigrationPlan } from './types.js';

export const generateMigrationPlan = (
  diff: DatabaseSnapshotDiff,
  options: GenerateMigrationPlanOptions = {},
): MigrationPlan => {
  const diagnostics = [...diff.diagnostics];

  const createEnumOperations: MigrationOperation[] = diff.changes.enumsCreated.map((change) => ({
    kind: 'create_enum',
    enum: change.next,
  }));

  const appendEnumValueOperations: MigrationOperation[] = diff.changes.enumValuesAppended.flatMap(
    (change) =>
      change.appendedValues.map(
        (value) =>
          ({
            kind: 'append_enum_value',
            enumName: change.enumName,
            enumDbName: change.next.dbName,
            value,
          }) as const,
      ),
  );

  const createTableOperations: MigrationOperation[] = diff.changes.tablesCreated.map((change) => ({
    kind: 'create_table',
    table: change.next,
  }));

  const addColumnOperations: MigrationOperation[] = diff.changes.columnsAdded.map((change) => ({
    kind: 'add_column',
    tableName: change.tableName,
    column: change.next,
  }));

  const alterColumnTypeOperations: MigrationOperation[] = diff.changes.columnsTypeChanged.map(
    (change) => ({
      kind: 'alter_column_type',
      tableName: change.tableName,
      columnName: change.columnName,
      previous: change.previous,
      next: change.next,
    }),
  );

  const alterColumnNullabilityOperations: MigrationOperation[] =
    diff.changes.columnsNullabilityChanged.map((change) => ({
      kind: 'alter_column_nullability',
      tableName: change.tableName,
      columnName: change.columnName,
      nullable: change.nextNullable,
    }));

  const alterColumnDefaultOperations: MigrationOperation[] = diff.changes.columnsDefaultChanged.map(
    (change) => {
      const nextColumn = diff.nextSnapshot.tables[change.tableName]?.columns[change.columnName];
      const previousColumn =
        diff.previousSnapshot?.tables[change.tableName]?.columns[change.columnName];
      const column = nextColumn ?? previousColumn;

      if (!column) {
        throw new Error(
          `Could not resolve column metadata for default change ${change.tableName}.${change.columnName}.`,
        );
      }

      return {
        kind: 'alter_column_default',
        tableName: change.tableName,
        columnName: change.columnName,
        default: change.next,
        column: {
          ...column,
          default: change.next,
        },
      };
    },
  );

  const addUniqueOperations: MigrationOperation[] = diff.changes.uniquesAdded.map((change) => ({
    kind: 'add_unique',
    tableName: change.tableName,
    unique: change.next,
  }));

  const addIndexOperations: MigrationOperation[] = diff.changes.indexesAdded.map((change) => ({
    kind: 'add_index',
    tableName: change.tableName,
    index: change.next,
  }));

  const addForeignKeyOperations: MigrationOperation[] = diff.changes.foreignKeysAdded.map(
    (change) => ({
      kind: 'add_foreign_key',
      tableName: change.tableName,
      foreignKey: change.next,
    }),
  );

  const foreignKeyOnDeleteRebuildOperations: MigrationOperation[] =
    diff.changes.foreignKeysOnDeleteChanged.flatMap((change) => [
      {
        kind: 'drop_foreign_key',
        tableName: change.tableName,
        foreignKey: change.previous,
      } as const,
      {
        kind: 'add_foreign_key',
        tableName: change.tableName,
        foreignKey: change.next,
      } as const,
    ]);

  const dropForeignKeyOperations: MigrationOperation[] = diff.changes.foreignKeysRemoved.map(
    (change) => ({
      kind: 'drop_foreign_key',
      tableName: change.tableName,
      foreignKey: change.previous,
    }),
  );

  const dropIndexOperations: MigrationOperation[] = diff.changes.indexesRemoved.map((change) => ({
    kind: 'drop_index',
    tableName: change.tableName,
    index: change.previous,
  }));

  const dropUniqueOperations: MigrationOperation[] = diff.changes.uniquesRemoved.map((change) => ({
    kind: 'drop_unique',
    tableName: change.tableName,
    unique: change.previous,
  }));

  const dropColumnOperations: MigrationOperation[] = diff.changes.columnsRemoved.map((change) => ({
    kind: 'drop_column',
    tableName: change.tableName,
    column: change.previous,
  }));

  const dropTableOperations: MigrationOperation[] = diff.changes.tablesRemoved.map((change) => ({
    kind: 'drop_table',
    table: change.previous,
  }));

  const dropEnumOperations: MigrationOperation[] = diff.changes.enumsRemoved.map((change) => ({
    kind: 'drop_enum',
    enum: change.previous,
  }));

  const operations: MigrationOperation[] = [
    ...createEnumOperations,
    ...appendEnumValueOperations,
    ...createTableOperations,
    ...addColumnOperations,
    ...alterColumnTypeOperations,
    ...alterColumnNullabilityOperations,
    ...alterColumnDefaultOperations,
    ...addUniqueOperations,
    ...addIndexOperations,
    ...addForeignKeyOperations,
    ...foreignKeyOnDeleteRebuildOperations,
    ...dropForeignKeyOperations,
    ...dropIndexOperations,
    ...dropUniqueOperations,
    ...dropColumnOperations,
    ...dropTableOperations,
    ...dropEnumOperations,
  ];

  const destructiveOrRisky = operations.flatMap((operation) => {
    if (operation.kind === 'drop_table') {
      return [
        createMigrationDiagnostic({
          code: 'DESTRUCTIVE_DROP_TABLE',
          severity: 'warning',
          message: `Dropping table "${operation.table.name}" is destructive.`,
          source: {
            table: operation.table.name,
          },
        }),
      ];
    }

    if (operation.kind === 'drop_column') {
      return [
        createMigrationDiagnostic({
          code: 'DESTRUCTIVE_DROP_COLUMN',
          severity: 'warning',
          message: `Dropping column "${operation.column.name}" from table "${operation.tableName}" is destructive.`,
          source: {
            table: operation.tableName,
            column: operation.column.name,
          },
        }),
      ];
    }

    if (operation.kind === 'drop_enum') {
      return [
        createMigrationDiagnostic({
          code: 'DESTRUCTIVE_DROP_ENUM',
          severity: 'warning',
          message: `Dropping enum "${operation.enum.name}" is destructive for dependent data.`,
          source: {
            enum: operation.enum.name,
          },
        }),
      ];
    }

    if (operation.kind === 'alter_column_type') {
      return [
        createMigrationDiagnostic({
          code: 'RISKY_ALTER_COLUMN_TYPE',
          severity: 'warning',
          message: `Altering type for "${operation.tableName}.${operation.columnName}" may require data conversion.`,
          source: {
            table: operation.tableName,
            column: operation.columnName,
          },
        }),
      ];
    }

    if (operation.kind === 'alter_column_nullability' && !operation.nullable) {
      return [
        createMigrationDiagnostic({
          code: 'RISKY_SET_NOT_NULL',
          severity: 'warning',
          message: `Tightening nullability to NOT NULL for "${operation.tableName}.${operation.columnName}" may fail on existing NULL rows.`,
          source: {
            table: operation.tableName,
            column: operation.columnName,
          },
        }),
      ];
    }

    return [];
  });

  diagnostics.push(...destructiveOrRisky);

  const shouldBlock =
    !options.allowDestructive &&
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code.startsWith('DESTRUCTIVE_') ||
        diagnostic.code.startsWith('RISKY_') ||
        diagnostic.severity === 'error',
    );

  if (shouldBlock) {
    diagnostics.push(
      createMigrationDiagnostic({
        code: 'PLAN_BLOCKED_REQUIRES_ALLOW_DESTRUCTIVE',
        severity: 'error',
        message:
          'Migration plan includes destructive/risky changes. Re-run with allowDestructive=true to generate SQL intentionally.',
      }),
    );
  }

  return {
    operations,
    diagnostics,
    blocked: shouldBlock,
  };
};
