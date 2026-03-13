import { createMigrationDiagnostic } from '../diagnostics/index.js';
import type { DatabaseSnapshotDiff } from '../diff/types.js';
import { collectRenameHints } from './collect-rename-hints.js';
import { orderMigrationOperations } from './order-migration-operations.js';
import type { GenerateMigrationPlanOptions, MigrationOperation, MigrationPlan } from './types.js';

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

const defaultsEqual = (left: unknown, right: unknown): boolean =>
  stableSerialize(left) === stableSerialize(right);
const columnTypeSignature = (column: {
  postgresType: string;
  enumDbName?: string;
  isArray: boolean;
}): string =>
  `${column.postgresType}|${column.enumDbName ?? ''}|${column.isArray ? 'array' : 'scalar'}`;

const isLikelyNarrowingTypeChange = (
  previous: { postgresType: string; isArray: boolean },
  next: { postgresType: string; isArray: boolean },
): boolean => {
  if (previous.isArray !== next.isArray) {
    return true;
  }

  if (previous.postgresType === next.postgresType) {
    return false;
  }

  const rank: Record<string, number> = {
    text: 100,
    jsonb: 95,
    numeric: 90,
    'double precision': 80,
    integer: 70,
    uuid: 60,
    timestamptz: 50,
    date: 40,
    time: 40,
    boolean: 30,
    bytea: 30,
  };

  const previousRank = rank[previous.postgresType] ?? 0;
  const nextRank = rank[next.postgresType] ?? 0;
  return nextRank < previousRank;
};

const buildRenameColumnFollowups = (
  tableName: string,
  tableDbName: string,
  fromColumnName: string,
  previousColumn: DatabaseSnapshotDiff['changes']['columnsRemoved'][number]['previous'],
  nextColumn: DatabaseSnapshotDiff['changes']['columnsAdded'][number]['next'],
): MigrationOperation[] => {
  const operations: MigrationOperation[] = [];
  if (columnTypeSignature(previousColumn) !== columnTypeSignature(nextColumn)) {
    operations.push({
      kind: 'alter_column_type',
      tableName,
      tableDbName,
      columnName: fromColumnName,
      previous: previousColumn,
      next: {
        ...nextColumn,
        name: fromColumnName,
      },
    });
  }
  if (previousColumn.nullable !== nextColumn.nullable) {
    operations.push({
      kind: 'alter_column_nullability',
      tableName,
      tableDbName,
      columnName: fromColumnName,
      nullable: nextColumn.nullable,
    });
  }
  if (!defaultsEqual(previousColumn.default, nextColumn.default)) {
    operations.push({
      kind: 'alter_column_default',
      tableName,
      tableDbName,
      columnName: fromColumnName,
      default: nextColumn.default,
      column: {
        ...nextColumn,
        name: fromColumnName,
      },
    });
  }
  return operations;
};

const buildRenamedTableStructuralOperations = (
  toTableName: string,
  tableDbName: string,
  previousTable: DatabaseSnapshotDiff['changes']['tablesRemoved'][number]['previous'],
  nextTable: DatabaseSnapshotDiff['changes']['tablesCreated'][number]['next'],
  renamedColumns: Array<{ fromColumnName: string; toColumnName: string }>,
): MigrationOperation[] => {
  const operations: MigrationOperation[] = [];
  const previousColumns = previousTable.columns;
  const nextColumns = nextTable.columns;
  const renamedFromSet = new Set(renamedColumns.map((entry) => entry.fromColumnName));
  const renamedToSet = new Set(renamedColumns.map((entry) => entry.toColumnName));

  const previousColumnNames = Object.keys(previousColumns).sort((a, b) => a.localeCompare(b));
  const nextColumnNames = Object.keys(nextColumns).sort((a, b) => a.localeCompare(b));

  for (const columnName of nextColumnNames) {
    if (!previousColumns[columnName] && !renamedToSet.has(columnName)) {
      operations.push({
        kind: 'add_column',
        tableName: toTableName,
        tableDbName,
        column: nextColumns[columnName],
      });
    }
  }
  for (const columnName of previousColumnNames) {
    if (!nextColumns[columnName] && !renamedFromSet.has(columnName)) {
      operations.push({
        kind: 'drop_column',
        tableName: toTableName,
        tableDbName,
        column: previousColumns[columnName],
      });
    }
  }
  for (const columnName of nextColumnNames) {
    const previousColumn = previousColumns[columnName];
    const nextColumn = nextColumns[columnName];
    if (!previousColumn || !nextColumn) {
      continue;
    }
    if (columnTypeSignature(previousColumn) !== columnTypeSignature(nextColumn)) {
      operations.push({
        kind: 'alter_column_type',
        tableName: toTableName,
        tableDbName,
        columnName,
        previous: previousColumn,
        next: nextColumn,
      });
    }
    if (previousColumn.nullable !== nextColumn.nullable) {
      operations.push({
        kind: 'alter_column_nullability',
        tableName: toTableName,
        tableDbName,
        columnName,
        nullable: nextColumn.nullable,
      });
    }
    if (!defaultsEqual(previousColumn.default, nextColumn.default)) {
      operations.push({
        kind: 'alter_column_default',
        tableName: toTableName,
        tableDbName,
        columnName,
        default: nextColumn.default,
        column: nextColumn,
      });
    }
  }

  const previousIndexes = previousTable.indexes;
  const nextIndexes = nextTable.indexes;
  for (const indexName of Object.keys(previousIndexes).sort((a, b) => a.localeCompare(b))) {
    if (!nextIndexes[indexName]) {
      operations.push({
        kind: 'drop_index',
        tableName: toTableName,
        tableDbName,
        index: previousIndexes[indexName],
      });
    }
  }
  for (const indexName of Object.keys(nextIndexes).sort((a, b) => a.localeCompare(b))) {
    if (!previousIndexes[indexName]) {
      operations.push({
        kind: 'add_index',
        tableName: toTableName,
        tableDbName,
        index: nextIndexes[indexName],
      });
    }
  }

  const previousUniques = previousTable.uniqueConstraints;
  const nextUniques = nextTable.uniqueConstraints;
  for (const uniqueName of Object.keys(previousUniques).sort((a, b) => a.localeCompare(b))) {
    if (!nextUniques[uniqueName]) {
      operations.push({
        kind: 'drop_unique',
        tableName: toTableName,
        tableDbName,
        unique: previousUniques[uniqueName],
      });
    }
  }
  for (const uniqueName of Object.keys(nextUniques).sort((a, b) => a.localeCompare(b))) {
    if (!previousUniques[uniqueName]) {
      operations.push({
        kind: 'add_unique',
        tableName: toTableName,
        tableDbName,
        unique: nextUniques[uniqueName],
      });
    }
  }

  const previousFks = previousTable.foreignKeys;
  const nextFks = nextTable.foreignKeys;
  for (const fkName of Object.keys(previousFks).sort((a, b) => a.localeCompare(b))) {
    const previousFk = previousFks[fkName];
    const nextFk = nextFks[fkName];
    if (!nextFk) {
      operations.push({
        kind: 'drop_foreign_key',
        tableName: toTableName,
        tableDbName,
        foreignKey: previousFk,
      });
      continue;
    }

    const sameTarget =
      stableSerialize(previousFk.columns) === stableSerialize(nextFk.columns) &&
      previousFk.referencedTable === nextFk.referencedTable &&
      stableSerialize(previousFk.referencedColumns) === stableSerialize(nextFk.referencedColumns);
    if (!sameTarget) {
      operations.push({
        kind: 'drop_foreign_key',
        tableName: toTableName,
        tableDbName,
        foreignKey: previousFk,
      });
      operations.push({
        kind: 'add_foreign_key',
        tableName: toTableName,
        tableDbName,
        foreignKey: nextFk,
      });
      continue;
    }
    if (previousFk.onDelete !== nextFk.onDelete) {
      operations.push({
        kind: 'drop_foreign_key',
        tableName: toTableName,
        tableDbName,
        foreignKey: previousFk,
      });
      operations.push({
        kind: 'add_foreign_key',
        tableName: toTableName,
        tableDbName,
        foreignKey: nextFk,
      });
    }
  }
  for (const fkName of Object.keys(nextFks).sort((a, b) => a.localeCompare(b))) {
    if (!previousFks[fkName]) {
      operations.push({
        kind: 'add_foreign_key',
        tableName: toTableName,
        tableDbName,
        foreignKey: nextFks[fkName],
      });
    }
  }

  return operations;
};

export const generateMigrationPlan = (
  diff: DatabaseSnapshotDiff,
  options: GenerateMigrationPlanOptions = {},
): MigrationPlan => {
  const diagnostics = [...diff.diagnostics];
  const resolveTableDbName = (
    tableName: string,
    source: 'next' | 'previous' | 'either' = 'either',
  ): string => {
    if (source === 'next') {
      return diff.nextSnapshot.tables[tableName]?.dbName ?? tableName;
    }
    if (source === 'previous') {
      return diff.previousSnapshot?.tables[tableName]?.dbName ?? tableName;
    }
    return (
      diff.nextSnapshot.tables[tableName]?.dbName ??
      diff.previousSnapshot?.tables[tableName]?.dbName ??
      tableName
    );
  };
  const collectedRenameHints = collectRenameHints(diff, options.renameHints);
  diagnostics.push(...collectedRenameHints.diagnostics);
  const consumedCreatedTables = new Set<string>();
  const consumedRemovedTables = new Set<string>();
  const consumedAddedColumns = new Set<string>();
  const consumedRemovedColumns = new Set<string>();

  const renameTableOperations: MigrationOperation[] = [];
  const renamedTableStructuralOperations: MigrationOperation[] = [];
  const renamedTablePairs = new Map<
    string,
    {
      fromTableName: string;
      previous: DatabaseSnapshotDiff['changes']['tablesRemoved'][number]['previous'];
      next: DatabaseSnapshotDiff['changes']['tablesCreated'][number]['next'];
    }
  >();
  for (const hint of collectedRenameHints.tableRenames) {
    const removed = diff.changes.tablesRemoved.find(
      (change) => change.tableName === hint.fromTableName,
    );
    const created = diff.changes.tablesCreated.find(
      (change) => change.tableName === hint.toTableName,
    );

    if (!removed || !created) {
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'INVALID_TABLE_RENAME_HINT',
          severity: hint.source === 'explicit' ? 'error' : 'warning',
          message: `Invalid table rename hint "${hint.fromTableName}" -> "${hint.toTableName}". Expected matching dropped/added tables in diff.`,
        }),
      );
      continue;
    }

    consumedRemovedTables.add(hint.fromTableName);
    consumedCreatedTables.add(hint.toTableName);
    const toDbName = created.next.dbName;
    renameTableOperations.push({
      kind: 'rename_table',
      tableName: hint.toTableName,
      fromDbName: removed.previous.dbName,
      toDbName,
    });
    renamedTablePairs.set(hint.toTableName, {
      fromTableName: hint.fromTableName,
      previous: removed.previous,
      next: created.next,
    });
  }

  const renameColumnOperations: MigrationOperation[] = [];
  const renameColumnFollowupOperations: MigrationOperation[] = [];
  const renamedColumnsByTable = new Map<
    string,
    Array<{ fromColumnName: string; toColumnName: string }>
  >();
  for (const hint of collectedRenameHints.columnRenames) {
    const removed = diff.changes.columnsRemoved.find(
      (change) => change.tableName === hint.tableName && change.columnName === hint.fromColumnName,
    );
    const added = diff.changes.columnsAdded.find(
      (change) => change.tableName === hint.tableName && change.columnName === hint.toColumnName,
    );

    let resolvedRemoved = removed;
    let resolvedAdded = added;
    if (!resolvedRemoved || !resolvedAdded) {
      const renamedPair = renamedTablePairs.get(hint.tableName);
      if (renamedPair) {
        const previousColumn = renamedPair.previous.columns[hint.fromColumnName];
        const nextColumn = renamedPair.next.columns[hint.toColumnName];
        if (previousColumn && nextColumn) {
          resolvedRemoved = {
            tableName: hint.tableName,
            columnName: hint.fromColumnName,
            previous: previousColumn,
          };
          resolvedAdded = {
            tableName: hint.tableName,
            columnName: hint.toColumnName,
            next: nextColumn,
          };
        }
      }
    }

    if (!resolvedRemoved || !resolvedAdded) {
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'INVALID_COLUMN_RENAME_HINT',
          severity: hint.source === 'explicit' ? 'error' : 'warning',
          message: `Invalid column rename hint "${hint.tableName}.${hint.fromColumnName}" -> "${hint.tableName}.${hint.toColumnName}". Expected matching dropped/added columns in diff.`,
        }),
      );
      continue;
    }

    const removedKey = `${hint.tableName}.${hint.fromColumnName}`;
    const addedKey = `${hint.tableName}.${hint.toColumnName}`;
    consumedRemovedColumns.add(removedKey);
    consumedAddedColumns.add(addedKey);

    renameColumnOperations.push({
      kind: 'rename_column',
      tableName: hint.tableName,
      tableDbName: resolveTableDbName(hint.tableName, 'either'),
      fromColumnName: hint.fromColumnName,
      toColumnName: hint.toColumnName,
    });
    const existingRenamedColumns = renamedColumnsByTable.get(hint.tableName) ?? [];
    existingRenamedColumns.push({
      fromColumnName: hint.fromColumnName,
      toColumnName: hint.toColumnName,
    });
    renamedColumnsByTable.set(hint.tableName, existingRenamedColumns);
    renameColumnFollowupOperations.push(
      ...buildRenameColumnFollowups(
        hint.tableName,
        resolveTableDbName(hint.tableName, 'either'),
        hint.fromColumnName,
        resolvedRemoved.previous,
        resolvedAdded.next,
      ),
    );
  }

  for (const [toTableName, pair] of renamedTablePairs.entries()) {
    const toDbName = pair.next.dbName;
    renamedTableStructuralOperations.push(
      ...buildRenamedTableStructuralOperations(
        toTableName,
        toDbName,
        pair.previous,
        pair.next,
        renamedColumnsByTable.get(toTableName) ?? [],
      ),
    );
  }

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

  const createTableOperations: MigrationOperation[] = diff.changes.tablesCreated
    .filter((change) => !consumedCreatedTables.has(change.tableName))
    .map((change) => ({
      kind: 'create_table',
      table: change.next,
    }));

  const addColumnOperations: MigrationOperation[] = diff.changes.columnsAdded
    .filter(
      (change) =>
        !consumedAddedColumns.has(`${change.tableName}.${change.columnName}`) &&
        !consumedCreatedTables.has(change.tableName),
    )
    .map((change) => ({
      kind: 'add_column',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'next'),
      column: change.next,
    }));

  const alterColumnTypeOperations: MigrationOperation[] = diff.changes.columnsTypeChanged.map(
    (change) => ({
      kind: 'alter_column_type',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'next'),
      columnName: change.columnName,
      previous: change.previous,
      next: change.next,
    }),
  );

  const alterColumnNullabilityOperations: MigrationOperation[] =
    diff.changes.columnsNullabilityChanged.map((change) => ({
      kind: 'alter_column_nullability',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'next'),
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
        tableDbName: resolveTableDbName(change.tableName, 'either'),
        columnName: change.columnName,
        default: change.next,
        column: {
          ...column,
          default: change.next,
        },
      };
    },
  );

  const addUniqueOperations: MigrationOperation[] = diff.changes.uniquesAdded
    .filter((change) => !consumedCreatedTables.has(change.tableName))
    .map((change) => ({
      kind: 'add_unique',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'next'),
      unique: change.next,
    }));

  const addIndexOperations: MigrationOperation[] = diff.changes.indexesAdded
    .filter((change) => !consumedCreatedTables.has(change.tableName))
    .map((change) => ({
      kind: 'add_index',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'next'),
      index: change.next,
    }));

  const addForeignKeyOperations: MigrationOperation[] = diff.changes.foreignKeysAdded
    .filter((change) => !consumedCreatedTables.has(change.tableName))
    .map((change) => ({
      kind: 'add_foreign_key',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'next'),
      foreignKey: change.next,
    }));

  const foreignKeyOnDeleteRebuildOperations: MigrationOperation[] =
    diff.changes.foreignKeysOnDeleteChanged.flatMap((change) => [
      {
        kind: 'drop_foreign_key',
        tableName: change.tableName,
        tableDbName: resolveTableDbName(change.tableName, 'previous'),
        foreignKey: change.previous,
      } as const,
      {
        kind: 'add_foreign_key',
        tableName: change.tableName,
        tableDbName: resolveTableDbName(change.tableName, 'next'),
        foreignKey: change.next,
      } as const,
    ]);

  const dropForeignKeyOperations: MigrationOperation[] = diff.changes.foreignKeysRemoved
    .filter((change) => !consumedRemovedTables.has(change.tableName))
    .map((change) => ({
      kind: 'drop_foreign_key',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'previous'),
      foreignKey: change.previous,
    }));

  const dropIndexOperations: MigrationOperation[] = diff.changes.indexesRemoved
    .filter((change) => !consumedRemovedTables.has(change.tableName))
    .map((change) => ({
      kind: 'drop_index',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'previous'),
      index: change.previous,
    }));

  const dropUniqueOperations: MigrationOperation[] = diff.changes.uniquesRemoved
    .filter((change) => !consumedRemovedTables.has(change.tableName))
    .map((change) => ({
      kind: 'drop_unique',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'previous'),
      unique: change.previous,
    }));

  const dropColumnOperations: MigrationOperation[] = diff.changes.columnsRemoved
    .filter(
      (change) =>
        !consumedRemovedColumns.has(`${change.tableName}.${change.columnName}`) &&
        !consumedRemovedTables.has(change.tableName),
    )
    .map((change) => ({
      kind: 'drop_column',
      tableName: change.tableName,
      tableDbName: resolveTableDbName(change.tableName, 'previous'),
      column: change.previous,
    }));

  const dropTableOperations: MigrationOperation[] = diff.changes.tablesRemoved
    .filter((change) => !consumedRemovedTables.has(change.tableName))
    .map((change) => ({
      kind: 'drop_table',
      table: change.previous,
    }));

  const dropEnumOperations: MigrationOperation[] = diff.changes.enumsRemoved.map((change) => ({
    kind: 'drop_enum',
    enum: change.previous,
  }));

  const operations = orderMigrationOperations([
    ...createEnumOperations,
    ...appendEnumValueOperations,
    ...createTableOperations,
    ...renameTableOperations,
    ...renamedTableStructuralOperations,
    ...renameColumnOperations,
    ...renameColumnFollowupOperations,
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
  ]);

  const destructiveOrRisky = operations.flatMap((operation) => {
    if (operation.kind === 'drop_table') {
      return [
        createMigrationDiagnostic({
          code: 'DESTRUCTIVE_DROP_TABLE',
          severity: 'warning',
          message: `Table "${operation.table.name}" will be dropped. This may destroy existing data.`,
          source: {
            table: operation.table.name,
          },
        }),
      ];
    }

    if (operation.kind === 'rename_table' || operation.kind === 'rename_column') {
      return [];
    }

    if (operation.kind === 'drop_column') {
      return [
        createMigrationDiagnostic({
          code: 'DESTRUCTIVE_DROP_COLUMN',
          severity: 'warning',
          message: `Column "${operation.column.name}" on table "${operation.tableName}" will be dropped. This may destroy existing data.`,
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
          message: `Enum "${operation.enum.name}" will be dropped. Dependent data may be invalidated.`,
          source: {
            enum: operation.enum.name,
          },
        }),
      ];
    }

    if (operation.kind === 'alter_column_type') {
      const narrowing = isLikelyNarrowingTypeChange(operation.previous, operation.next);
      return [
        createMigrationDiagnostic({
          code: narrowing ? 'RISKY_NARROWING_TYPE_CHANGE' : 'RISKY_ALTER_COLUMN_TYPE',
          severity: 'warning',
          message: narrowing
            ? `Column "${operation.columnName}" on table "${operation.tableName}" is changing to a narrower type. Existing rows may fail conversion.`
            : `Altering type for "${operation.tableName}.${operation.columnName}" may require data conversion.`,
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
          message: `Column "${operation.columnName}" on table "${operation.tableName}" is changing from nullable to non-nullable. Existing rows may violate this constraint.`,
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
