import { createMigrationDiagnostic, type MigrationDiagnostic } from '../diagnostics/index.js';
import type {
  DatabaseColumnSnapshot,
  DatabaseEnumSnapshot,
  DatabaseForeignKeySnapshot,
  DatabaseSnapshot,
  DatabaseTableSnapshot,
} from '../snapshot/types.js';
import type { DatabaseSnapshotDiff } from './types.js';

const sortBy = <TValue>(values: TValue[], selector: (value: TValue) => string): TValue[] =>
  [...values].sort((a, b) => selector(a).localeCompare(selector(b)));

const recordKeys = (record: Record<string, unknown>): string[] =>
  Object.keys(record).sort((a, b) => a.localeCompare(b));

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

const defaultsEqual = (
  left: DatabaseColumnSnapshot['default'],
  right: DatabaseColumnSnapshot['default'],
): boolean => {
  return stableSerialize(left) === stableSerialize(right);
};

const columnTypeSignature = (column: DatabaseColumnSnapshot): string =>
  `${column.postgresType}|${column.enumDbName ?? ''}|${column.isArray ? 'array' : 'scalar'}`;

const isAppendOnlyEnumChange = (previousValues: string[], nextValues: string[]): boolean => {
  if (nextValues.length < previousValues.length) {
    return false;
  }

  for (let index = 0; index < previousValues.length; index += 1) {
    if (previousValues[index] !== nextValues[index]) {
      return false;
    }
  }

  return true;
};

const diffEnums = (
  previousEnums: Record<string, DatabaseEnumSnapshot>,
  nextEnums: Record<string, DatabaseEnumSnapshot>,
  diagnostics: MigrationDiagnostic[],
): Pick<
  DatabaseSnapshotDiff['changes'],
  'enumsCreated' | 'enumsRemoved' | 'enumValuesAppended'
> => {
  const enumsCreated = sortBy(
    recordKeys(nextEnums)
      .filter((enumName) => !previousEnums[enumName])
      .map((enumName) => ({
        enumName,
        next: nextEnums[enumName],
      })),
    (change) => change.enumName,
  );

  const enumsRemoved = sortBy(
    recordKeys(previousEnums)
      .filter((enumName) => !nextEnums[enumName])
      .map((enumName) => ({
        enumName,
        previous: previousEnums[enumName],
      })),
    (change) => change.enumName,
  );

  const enumValuesAppended = sortBy(
    recordKeys(nextEnums)
      .filter((enumName) => Boolean(previousEnums[enumName]))
      .flatMap((enumName) => {
        const previousEnum = previousEnums[enumName];
        const nextEnum = nextEnums[enumName];

        if (stableSerialize(previousEnum.values) === stableSerialize(nextEnum.values)) {
          return [];
        }

        if (isAppendOnlyEnumChange(previousEnum.values, nextEnum.values)) {
          return [
            {
              enumName,
              appendedValues: nextEnum.values.slice(previousEnum.values.length),
              previous: previousEnum,
              next: nextEnum,
            },
          ];
        }

        diagnostics.push(
          createMigrationDiagnostic({
            code: 'ENUM_MUTATION_UNSUPPORTED',
            severity: 'error',
            message: `Enum "${enumName}" changed in a non-append-only way (reorder/removal/rewrite). v1 requires manual migration handling.`,
            source: {
              enum: enumName,
            },
          }),
        );

        return [];
      }),
    (change) => change.enumName,
  );

  return {
    enumsCreated,
    enumsRemoved,
    enumValuesAppended,
  };
};

const diffColumns = (
  tableName: string,
  previousTable: DatabaseTableSnapshot,
  nextTable: DatabaseTableSnapshot,
): Pick<
  DatabaseSnapshotDiff['changes'],
  | 'columnsAdded'
  | 'columnsRemoved'
  | 'columnsTypeChanged'
  | 'columnsNullabilityChanged'
  | 'columnsDefaultChanged'
> => {
  const previousColumns = previousTable.columns;
  const nextColumns = nextTable.columns;

  const columnsAdded = sortBy(
    recordKeys(nextColumns)
      .filter((columnName) => !previousColumns[columnName])
      .map((columnName) => ({
        tableName,
        columnName,
        next: nextColumns[columnName],
      })),
    (change) => `${change.tableName}.${change.columnName}`,
  );

  const columnsRemoved = sortBy(
    recordKeys(previousColumns)
      .filter((columnName) => !nextColumns[columnName])
      .map((columnName) => ({
        tableName,
        columnName,
        previous: previousColumns[columnName],
      })),
    (change) => `${change.tableName}.${change.columnName}`,
  );

  const commonColumnNames = recordKeys(nextColumns).filter((columnName) =>
    Boolean(previousColumns[columnName]),
  );

  const columnsTypeChanged = sortBy(
    commonColumnNames
      .filter(
        (columnName) =>
          columnTypeSignature(previousColumns[columnName]) !==
          columnTypeSignature(nextColumns[columnName]),
      )
      .map((columnName) => ({
        tableName,
        columnName,
        previous: previousColumns[columnName],
        next: nextColumns[columnName],
      })),
    (change) => `${change.tableName}.${change.columnName}`,
  );

  const columnsNullabilityChanged = sortBy(
    commonColumnNames
      .filter(
        (columnName) => previousColumns[columnName].nullable !== nextColumns[columnName].nullable,
      )
      .map((columnName) => ({
        tableName,
        columnName,
        previousNullable: previousColumns[columnName].nullable,
        nextNullable: nextColumns[columnName].nullable,
      })),
    (change) => `${change.tableName}.${change.columnName}`,
  );

  const columnsDefaultChanged = sortBy(
    commonColumnNames
      .filter(
        (columnName) =>
          !defaultsEqual(previousColumns[columnName].default, nextColumns[columnName].default),
      )
      .map((columnName) => ({
        tableName,
        columnName,
        previous: previousColumns[columnName].default,
        next: nextColumns[columnName].default,
      })),
    (change) => `${change.tableName}.${change.columnName}`,
  );

  return {
    columnsAdded,
    columnsRemoved,
    columnsTypeChanged,
    columnsNullabilityChanged,
    columnsDefaultChanged,
  };
};

const foreignKeySignatureWithoutOnDelete = (foreignKey: DatabaseForeignKeySnapshot): string => {
  return `${stableSerialize(foreignKey.columns)}|${foreignKey.referencedTable}|${stableSerialize(foreignKey.referencedColumns)}`;
};

const diffConstraintFamilies = (
  tableName: string,
  previousTable: DatabaseTableSnapshot,
  nextTable: DatabaseTableSnapshot,
): Pick<
  DatabaseSnapshotDiff['changes'],
  | 'indexesAdded'
  | 'indexesRemoved'
  | 'uniquesAdded'
  | 'uniquesRemoved'
  | 'foreignKeysAdded'
  | 'foreignKeysRemoved'
  | 'foreignKeysOnDeleteChanged'
> => {
  const indexesAdded = recordKeys(nextTable.indexes)
    .filter((indexName) => !previousTable.indexes[indexName])
    .map((indexName) => ({
      tableName,
      indexName,
      next: nextTable.indexes[indexName],
    }));

  const indexesRemoved = recordKeys(previousTable.indexes)
    .filter((indexName) => !nextTable.indexes[indexName])
    .map((indexName) => ({
      tableName,
      indexName,
      previous: previousTable.indexes[indexName],
    }));

  const uniquesAdded = recordKeys(nextTable.uniqueConstraints)
    .filter((uniqueName) => !previousTable.uniqueConstraints[uniqueName])
    .map((uniqueName) => ({
      tableName,
      uniqueName,
      next: nextTable.uniqueConstraints[uniqueName],
    }));

  const uniquesRemoved = recordKeys(previousTable.uniqueConstraints)
    .filter((uniqueName) => !nextTable.uniqueConstraints[uniqueName])
    .map((uniqueName) => ({
      tableName,
      uniqueName,
      previous: previousTable.uniqueConstraints[uniqueName],
    }));

  const foreignKeysAdded = recordKeys(nextTable.foreignKeys)
    .filter((foreignKeyName) => !previousTable.foreignKeys[foreignKeyName])
    .map((foreignKeyName) => ({
      tableName,
      foreignKeyName,
      next: nextTable.foreignKeys[foreignKeyName],
    }));

  const foreignKeysRemoved = recordKeys(previousTable.foreignKeys)
    .filter((foreignKeyName) => !nextTable.foreignKeys[foreignKeyName])
    .map((foreignKeyName) => ({
      tableName,
      foreignKeyName,
      previous: previousTable.foreignKeys[foreignKeyName],
    }));

  const foreignKeysOnDeleteChanged: DatabaseSnapshotDiff['changes']['foreignKeysOnDeleteChanged'] =
    [];

  for (const foreignKeyName of recordKeys(nextTable.foreignKeys)) {
    const previousForeignKey = previousTable.foreignKeys[foreignKeyName];
    const nextForeignKey = nextTable.foreignKeys[foreignKeyName];

    if (!previousForeignKey || !nextForeignKey) {
      continue;
    }

    const previousSignature = foreignKeySignatureWithoutOnDelete(previousForeignKey);
    const nextSignature = foreignKeySignatureWithoutOnDelete(nextForeignKey);

    if (previousSignature !== nextSignature) {
      foreignKeysRemoved.push({
        tableName,
        foreignKeyName,
        previous: previousForeignKey,
      });
      foreignKeysAdded.push({
        tableName,
        foreignKeyName,
        next: nextForeignKey,
      });
      continue;
    }

    if (previousForeignKey.onDelete !== nextForeignKey.onDelete) {
      foreignKeysOnDeleteChanged.push({
        tableName,
        foreignKeyName,
        previousOnDelete: previousForeignKey.onDelete,
        nextOnDelete: nextForeignKey.onDelete,
        previous: previousForeignKey,
        next: nextForeignKey,
      });
    }
  }

  return {
    indexesAdded: sortBy(indexesAdded, (change) => `${change.tableName}.${change.indexName}`),
    indexesRemoved: sortBy(indexesRemoved, (change) => `${change.tableName}.${change.indexName}`),
    uniquesAdded: sortBy(uniquesAdded, (change) => `${change.tableName}.${change.uniqueName}`),
    uniquesRemoved: sortBy(uniquesRemoved, (change) => `${change.tableName}.${change.uniqueName}`),
    foreignKeysAdded: sortBy(
      foreignKeysAdded,
      (change) => `${change.tableName}.${change.foreignKeyName}`,
    ),
    foreignKeysRemoved: sortBy(
      foreignKeysRemoved,
      (change) => `${change.tableName}.${change.foreignKeyName}`,
    ),
    foreignKeysOnDeleteChanged: sortBy(
      foreignKeysOnDeleteChanged,
      (change) => `${change.tableName}.${change.foreignKeyName}`,
    ),
  };
};

const emptyChanges = (): DatabaseSnapshotDiff['changes'] => ({
  enumsCreated: [],
  enumsRemoved: [],
  enumValuesAppended: [],
  tablesCreated: [],
  tablesRemoved: [],
  columnsAdded: [],
  columnsRemoved: [],
  columnsTypeChanged: [],
  columnsNullabilityChanged: [],
  columnsDefaultChanged: [],
  indexesAdded: [],
  indexesRemoved: [],
  uniquesAdded: [],
  uniquesRemoved: [],
  foreignKeysAdded: [],
  foreignKeysRemoved: [],
  foreignKeysOnDeleteChanged: [],
});

export const diffDatabaseSnapshots = (
  previousSnapshot: DatabaseSnapshot | null,
  nextSnapshot: DatabaseSnapshot,
): DatabaseSnapshotDiff => {
  const diagnostics: MigrationDiagnostic[] = [];
  const changes = emptyChanges();

  if (!previousSnapshot) {
    changes.enumsCreated = sortBy(
      Object.values(nextSnapshot.enums).map((next) => ({
        enumName: next.name,
        next,
      })),
      (change) => change.enumName,
    );

    changes.tablesCreated = sortBy(
      Object.values(nextSnapshot.tables).map((next) => ({
        tableName: next.name,
        next,
      })),
      (change) => change.tableName,
    );

    changes.indexesAdded = sortBy(
      changes.tablesCreated.flatMap((change) =>
        Object.values(change.next.indexes).map((index) => ({
          tableName: change.tableName,
          indexName: index.name,
          next: index,
        })),
      ),
      (change) => `${change.tableName}.${change.indexName}`,
    );

    changes.uniquesAdded = sortBy(
      changes.tablesCreated.flatMap((change) =>
        Object.values(change.next.uniqueConstraints).map((unique) => ({
          tableName: change.tableName,
          uniqueName: unique.name,
          next: unique,
        })),
      ),
      (change) => `${change.tableName}.${change.uniqueName}`,
    );

    changes.foreignKeysAdded = sortBy(
      changes.tablesCreated.flatMap((change) =>
        Object.values(change.next.foreignKeys).map((foreignKey) => ({
          tableName: change.tableName,
          foreignKeyName: foreignKey.name,
          next: foreignKey,
        })),
      ),
      (change) => `${change.tableName}.${change.foreignKeyName}`,
    );

    return {
      previousSnapshot,
      nextSnapshot,
      changes,
      diagnostics,
      hasChanges: changes.enumsCreated.length > 0 || changes.tablesCreated.length > 0,
    };
  }

  const enumDiff = diffEnums(previousSnapshot.enums, nextSnapshot.enums, diagnostics);
  changes.enumsCreated = enumDiff.enumsCreated;
  changes.enumsRemoved = enumDiff.enumsRemoved;
  changes.enumValuesAppended = enumDiff.enumValuesAppended;

  const previousTables = previousSnapshot.tables;
  const nextTables = nextSnapshot.tables;

  changes.tablesCreated = sortBy(
    recordKeys(nextTables)
      .filter((tableName) => !previousTables[tableName])
      .map((tableName) => ({
        tableName,
        next: nextTables[tableName],
      })),
    (change) => change.tableName,
  );

  changes.indexesAdded.push(
    ...changes.tablesCreated.flatMap((change) =>
      Object.values(change.next.indexes).map((index) => ({
        tableName: change.tableName,
        indexName: index.name,
        next: index,
      })),
    ),
  );

  changes.uniquesAdded.push(
    ...changes.tablesCreated.flatMap((change) =>
      Object.values(change.next.uniqueConstraints).map((unique) => ({
        tableName: change.tableName,
        uniqueName: unique.name,
        next: unique,
      })),
    ),
  );

  changes.foreignKeysAdded.push(
    ...changes.tablesCreated.flatMap((change) =>
      Object.values(change.next.foreignKeys).map((foreignKey) => ({
        tableName: change.tableName,
        foreignKeyName: foreignKey.name,
        next: foreignKey,
      })),
    ),
  );

  changes.tablesRemoved = sortBy(
    recordKeys(previousTables)
      .filter((tableName) => !nextTables[tableName])
      .map((tableName) => ({
        tableName,
        previous: previousTables[tableName],
      })),
    (change) => change.tableName,
  );

  const commonTableNames = recordKeys(nextTables).filter((tableName) =>
    Boolean(previousTables[tableName]),
  );

  for (const tableName of commonTableNames) {
    const previousTable = previousTables[tableName];
    const nextTable = nextTables[tableName];

    const columnDiff = diffColumns(tableName, previousTable, nextTable);

    changes.columnsAdded.push(...columnDiff.columnsAdded);
    changes.columnsRemoved.push(...columnDiff.columnsRemoved);
    changes.columnsTypeChanged.push(...columnDiff.columnsTypeChanged);
    changes.columnsNullabilityChanged.push(...columnDiff.columnsNullabilityChanged);
    changes.columnsDefaultChanged.push(...columnDiff.columnsDefaultChanged);

    const constraintDiff = diffConstraintFamilies(tableName, previousTable, nextTable);

    changes.indexesAdded.push(...constraintDiff.indexesAdded);
    changes.indexesRemoved.push(...constraintDiff.indexesRemoved);
    changes.uniquesAdded.push(...constraintDiff.uniquesAdded);
    changes.uniquesRemoved.push(...constraintDiff.uniquesRemoved);
    changes.foreignKeysAdded.push(...constraintDiff.foreignKeysAdded);
    changes.foreignKeysRemoved.push(...constraintDiff.foreignKeysRemoved);
    changes.foreignKeysOnDeleteChanged.push(...constraintDiff.foreignKeysOnDeleteChanged);
  }

  const sortedChanges: DatabaseSnapshotDiff['changes'] = {
    enumsCreated: sortBy(changes.enumsCreated, (change) => change.enumName),
    enumsRemoved: sortBy(changes.enumsRemoved, (change) => change.enumName),
    enumValuesAppended: sortBy(changes.enumValuesAppended, (change) => change.enumName),
    tablesCreated: sortBy(changes.tablesCreated, (change) => change.tableName),
    tablesRemoved: sortBy(changes.tablesRemoved, (change) => change.tableName),
    columnsAdded: sortBy(
      changes.columnsAdded,
      (change) => `${change.tableName}.${change.columnName}`,
    ),
    columnsRemoved: sortBy(
      changes.columnsRemoved,
      (change) => `${change.tableName}.${change.columnName}`,
    ),
    columnsTypeChanged: sortBy(
      changes.columnsTypeChanged,
      (change) => `${change.tableName}.${change.columnName}`,
    ),
    columnsNullabilityChanged: sortBy(
      changes.columnsNullabilityChanged,
      (change) => `${change.tableName}.${change.columnName}`,
    ),
    columnsDefaultChanged: sortBy(
      changes.columnsDefaultChanged,
      (change) => `${change.tableName}.${change.columnName}`,
    ),
    indexesAdded: sortBy(
      changes.indexesAdded,
      (change) => `${change.tableName}.${change.indexName}`,
    ),
    indexesRemoved: sortBy(
      changes.indexesRemoved,
      (change) => `${change.tableName}.${change.indexName}`,
    ),
    uniquesAdded: sortBy(
      changes.uniquesAdded,
      (change) => `${change.tableName}.${change.uniqueName}`,
    ),
    uniquesRemoved: sortBy(
      changes.uniquesRemoved,
      (change) => `${change.tableName}.${change.uniqueName}`,
    ),
    foreignKeysAdded: sortBy(
      changes.foreignKeysAdded,
      (change) => `${change.tableName}.${change.foreignKeyName}`,
    ),
    foreignKeysRemoved: sortBy(
      changes.foreignKeysRemoved,
      (change) => `${change.tableName}.${change.foreignKeyName}`,
    ),
    foreignKeysOnDeleteChanged: sortBy(
      changes.foreignKeysOnDeleteChanged,
      (change) => `${change.tableName}.${change.foreignKeyName}`,
    ),
  };

  const hasChanges = Object.values(sortedChanges).some((entries) => entries.length > 0);

  return {
    previousSnapshot,
    nextSnapshot,
    changes: sortedChanges,
    diagnostics,
    hasChanges,
  };
};
