import type { DatabaseSnapshotDiff } from '../diff/types.js';
import type { DatabaseColumnSnapshot, DatabaseTableSnapshot } from '../snapshot/types.js';
import type {
  AmbiguousColumnCandidate,
  AmbiguousColumnChange,
  AmbiguousTableCandidate,
  AmbiguousTableChange,
  DetectedAmbiguities,
} from './types.js';

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

const normalizedColumnShape = (column: DatabaseColumnSnapshot) => ({
  postgresType: column.postgresType,
  enumDbName: column.enumDbName,
  isArray: column.isArray,
  nullable: column.nullable,
  default: column.default,
  isPrimaryKey: column.isPrimaryKey,
  builtIn: column.builtIn,
});

const normalizeTableShape = (table: DatabaseTableSnapshot) => ({
  columns: Object.fromEntries(
    Object.entries(table.columns).map(([columnName, column]) => [
      columnName,
      normalizedColumnShape(column),
    ]),
  ),
  primaryKey: table.primaryKey
    ? { columns: [...table.primaryKey.columns].sort((a, b) => a.localeCompare(b)) }
    : undefined,
  indexes: Object.values(table.indexes)
    .map((index) => [...index.columns].sort((a, b) => a.localeCompare(b)))
    .sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
  uniqueConstraints: Object.values(table.uniqueConstraints)
    .map((unique) => [...unique.columns].sort((a, b) => a.localeCompare(b)))
    .sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
  foreignKeys: Object.values(table.foreignKeys)
    .map((foreignKey) => ({
      columns: [...foreignKey.columns].sort((a, b) => a.localeCompare(b)),
      referencedTable: foreignKey.referencedTable,
      referencedColumns: [...foreignKey.referencedColumns].sort((a, b) => a.localeCompare(b)),
      onDelete: foreignKey.onDelete,
    }))
    .sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
});

const diceCoefficient = (left: string, right: string): number => {
  if (left === right) {
    return 1;
  }

  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const bigrams = (value: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };

  const gramsA = bigrams(a);
  const gramsB = bigrams(b);

  let intersection = 0;
  for (const [gram, countA] of gramsA.entries()) {
    const countB = gramsB.get(gram) ?? 0;
    intersection += Math.min(countA, countB);
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
};

const shapeSimilarityForTables = (
  left: DatabaseTableSnapshot,
  right: DatabaseTableSnapshot,
): number => {
  if (stableSerialize(normalizeTableShape(left)) === stableSerialize(normalizeTableShape(right))) {
    return 1;
  }

  const leftColumns = new Set(Object.keys(left.columns));
  const rightColumns = new Set(Object.keys(right.columns));
  const union = new Set([...leftColumns, ...rightColumns]);
  if (union.size === 0) {
    return 0;
  }
  const intersection = [...leftColumns].filter((name) => rightColumns.has(name)).length;
  return intersection / union.size;
};

const shapeSimilarityForColumns = (
  left: DatabaseColumnSnapshot,
  right: DatabaseColumnSnapshot,
): number =>
  stableSerialize(normalizedColumnShape(left)) === stableSerialize(normalizedColumnShape(right))
    ? 1
    : 0;

const buildTableCandidate = (
  missingTableName: string,
  missingTable: DatabaseTableSnapshot,
  candidateName: string,
  candidate: DatabaseTableSnapshot,
): AmbiguousTableCandidate => {
  const nameSimilarity = diceCoefficient(missingTableName, candidateName);
  const shapeSimilarity = shapeSimilarityForTables(missingTable, candidate);
  const score = shapeSimilarity * 0.75 + nameSimilarity * 0.25;
  return {
    tableName: candidateName,
    table: candidate,
    score: {
      score,
      nameSimilarity,
      shapeSimilarity,
    },
  };
};

const buildColumnCandidate = (
  missingColumnName: string,
  missingColumn: DatabaseColumnSnapshot,
  candidateName: string,
  candidate: DatabaseColumnSnapshot,
): AmbiguousColumnCandidate => {
  const nameSimilarity = diceCoefficient(missingColumnName, candidateName);
  const shapeSimilarity = shapeSimilarityForColumns(missingColumn, candidate);
  const score = shapeSimilarity * 0.85 + nameSimilarity * 0.15;
  return {
    columnName: candidateName,
    column: candidate,
    score: {
      score,
      nameSimilarity,
      shapeSimilarity,
    },
  };
};

export const detectColumnAmbiguitiesForTablePair = (
  tableName: string,
  previousTable: DatabaseTableSnapshot,
  nextTable: DatabaseTableSnapshot,
): AmbiguousColumnChange[] => {
  const previousOnly = Object.keys(previousTable.columns)
    .filter((columnName) => !nextTable.columns[columnName])
    .sort((a, b) => a.localeCompare(b));
  const nextOnly = Object.keys(nextTable.columns)
    .filter((columnName) => !previousTable.columns[columnName])
    .sort((a, b) => a.localeCompare(b));

  if (previousOnly.length === 0 || nextOnly.length === 0) {
    return [];
  }

  return previousOnly.map((missingColumnName) => ({
    kind: 'column',
    tableName,
    missingColumnName,
    missingColumn: previousTable.columns[missingColumnName],
    candidates: nextOnly
      .map((candidateColumnName) =>
        buildColumnCandidate(
          missingColumnName,
          previousTable.columns[missingColumnName],
          candidateColumnName,
          nextTable.columns[candidateColumnName],
        ),
      )
      .sort((a, b) => {
        const byScore = byScoreDesc(a, b);
        if (byScore !== 0) {
          return byScore;
        }
        return a.columnName.localeCompare(b.columnName);
      }),
  }));
};

const byScoreDesc = <
  TValue extends {
    score: { score: number };
  },
>(
  left: TValue,
  right: TValue,
): number => {
  if (right.score.score !== left.score.score) {
    return right.score.score - left.score.score;
  }
  return 0;
};

export const detectAmbiguousChanges = (diff: DatabaseSnapshotDiff): DetectedAmbiguities => {
  const tables: AmbiguousTableChange[] = diff.changes.tablesRemoved
    .filter(() => diff.changes.tablesCreated.length > 0)
    .map(
      (removed): AmbiguousTableChange => ({
        kind: 'table',
        missingTableName: removed.tableName,
        missingTable: removed.previous,
        candidates: diff.changes.tablesCreated
          .map((created) =>
            buildTableCandidate(
              removed.tableName,
              removed.previous,
              created.tableName,
              created.next,
            ),
          )
          .sort((a, b) => {
            const byScore = byScoreDesc(a, b);
            if (byScore !== 0) {
              return byScore;
            }
            return a.tableName.localeCompare(b.tableName);
          }),
      }),
    );

  const changesByTable = new Map<
    string,
    { removed: typeof diff.changes.columnsRemoved; added: typeof diff.changes.columnsAdded }
  >();
  for (const removed of diff.changes.columnsRemoved) {
    const current = changesByTable.get(removed.tableName) ?? { removed: [], added: [] };
    current.removed.push(removed);
    changesByTable.set(removed.tableName, current);
  }
  for (const added of diff.changes.columnsAdded) {
    const current = changesByTable.get(added.tableName) ?? { removed: [], added: [] };
    current.added.push(added);
    changesByTable.set(added.tableName, current);
  }

  const columns: AmbiguousColumnChange[] = [...changesByTable.entries()]
    .flatMap(([tableName, tableChanges]) =>
      detectColumnAmbiguitiesForTablePair(
        tableName,
        {
          name: tableName,
          dbName: tableName,
          sourcePath: '',
          columns: Object.fromEntries(
            tableChanges.removed.map((removed) => [removed.columnName, removed.previous]),
          ),
          primaryKey: undefined,
          indexes: {},
          uniqueConstraints: {},
          foreignKeys: {},
        },
        {
          name: tableName,
          dbName: tableName,
          sourcePath: '',
          columns: Object.fromEntries(
            tableChanges.added.map((added) => [added.columnName, added.next]),
          ),
          primaryKey: undefined,
          indexes: {},
          uniqueConstraints: {},
          foreignKeys: {},
        },
      ),
    )
    .filter((entry) => entry.candidates.length > 0)
    .sort((a, b) => {
      const tableOrder = a.tableName.localeCompare(b.tableName);
      if (tableOrder !== 0) {
        return tableOrder;
      }
      return a.missingColumnName.localeCompare(b.missingColumnName);
    });

  return {
    tables,
    columns,
  };
};
