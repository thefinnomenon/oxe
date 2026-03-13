import { diffDatabaseSnapshots, type DatabaseSnapshotDiff } from '../diff/index.js';
import { introspectDatabaseSnapshot } from '../introspection/index.js';
import type { DatabaseSnapshot } from '../snapshot/types.js';
import type { IntrospectDatabaseSnapshotOptions } from '../introspection/types.js';

const sortRecordByKey = <TValue>(record: Record<string, TValue>): Record<string, TValue> =>
  Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));

const canonicalizeSnapshotForDatabaseComparison = (
  snapshot: DatabaseSnapshot,
): DatabaseSnapshot => {
  const enums = sortRecordByKey(
    Object.fromEntries(
      Object.values(snapshot.enums).map((entry) => [
        entry.dbName,
        {
          ...entry,
          name: entry.dbName,
          dbName: entry.dbName,
        },
      ]),
    ),
  );

  const tables = sortRecordByKey(
    Object.fromEntries(
      Object.values(snapshot.tables).map((table) => [
        table.dbName,
        {
          ...table,
          name: table.dbName,
          dbName: table.dbName,
        },
      ]),
    ),
  );

  return {
    ...snapshot,
    enums,
    tables,
  };
};

export interface DriftSummary {
  missingTables: string[];
  extraTables: string[];
  missingColumns: string[];
  extraColumns: string[];
}

export interface DatabaseDriftResult {
  hasDrift: boolean;
  diff: DatabaseSnapshotDiff;
  summary: DriftSummary;
}

export const detectDatabaseDrift = (
  expectedSnapshot: DatabaseSnapshot,
  actualSnapshot: DatabaseSnapshot,
): DatabaseDriftResult => {
  const canonicalExpected = canonicalizeSnapshotForDatabaseComparison(expectedSnapshot);
  const canonicalActual = canonicalizeSnapshotForDatabaseComparison(actualSnapshot);
  const diff = diffDatabaseSnapshots(canonicalActual, canonicalExpected);

  return {
    hasDrift: diff.hasChanges || diff.diagnostics.length > 0,
    diff,
    summary: {
      missingTables: diff.changes.tablesCreated.map((change) => change.tableName),
      extraTables: diff.changes.tablesRemoved.map((change) => change.tableName),
      missingColumns: diff.changes.columnsAdded.map(
        (change) => `${change.tableName}.${change.columnName}`,
      ),
      extraColumns: diff.changes.columnsRemoved.map(
        (change) => `${change.tableName}.${change.columnName}`,
      ),
    },
  };
};

export const detectDatabaseDriftFromPostgres = async (input: {
  expectedSnapshot: DatabaseSnapshot;
  connection: IntrospectDatabaseSnapshotOptions;
}): Promise<DatabaseDriftResult> => {
  const actualSnapshot = await introspectDatabaseSnapshot(input.connection);
  return detectDatabaseDrift(input.expectedSnapshot, actualSnapshot);
};
