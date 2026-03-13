import { createMigrationDiagnostic } from '../diagnostics/index.js';
import type { MigrationDiagnostic } from '../diagnostics/types.js';
import type { DatabaseSnapshotDiff } from '../diff/types.js';
import type { MigrationRenameHints } from './types.js';

type HintSource = 'explicit' | 'schema';

export interface ResolvedTableRenameHint {
  fromTableName: string;
  toTableName: string;
  source: HintSource;
}

export interface ResolvedColumnRenameHint {
  tableName: string;
  fromColumnName: string;
  toColumnName: string;
  source: HintSource;
}

export interface CollectRenameHintsResult {
  tableRenames: ResolvedTableRenameHint[];
  columnRenames: ResolvedColumnRenameHint[];
  diagnostics: MigrationDiagnostic[];
}

const stableSort = <TValue>(values: TValue[], selector: (value: TValue) => string): TValue[] => {
  return [...values].sort((left, right) => selector(left).localeCompare(selector(right)));
};

const collectSchemaTableHints = (
  diff: DatabaseSnapshotDiff,
): Array<Omit<ResolvedTableRenameHint, 'source'>> => {
  return diff.changes.tablesCreated
    .map((change) => ({
      fromTableName: change.next.renameFrom,
      toTableName: change.tableName,
    }))
    .filter(
      (
        entry,
      ): entry is {
        fromTableName: string;
        toTableName: string;
      } => Boolean(entry.fromTableName),
    );
};

const collectSchemaColumnHints = (
  diff: DatabaseSnapshotDiff,
): Array<Omit<ResolvedColumnRenameHint, 'source'>> => {
  const createdTables = new Set(diff.changes.tablesCreated.map((change) => change.tableName));
  const addedColumns = new Set(
    diff.changes.columnsAdded.map((change) => `${change.tableName}.${change.columnName}`),
  );
  const hints: Array<Omit<ResolvedColumnRenameHint, 'source'>> = [];

  for (const [tableName, table] of Object.entries(diff.nextSnapshot.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (!column.renameFrom) {
        continue;
      }

      if (createdTables.has(tableName) || addedColumns.has(`${tableName}.${columnName}`)) {
        hints.push({
          tableName,
          fromColumnName: column.renameFrom,
          toColumnName: columnName,
        });
      }
    }
  }

  return hints;
};

const sortTableRenames = (entries: ResolvedTableRenameHint[]): ResolvedTableRenameHint[] =>
  stableSort(entries, (entry) => `${entry.fromTableName}->${entry.toTableName}`);

const sortColumnRenames = (entries: ResolvedColumnRenameHint[]): ResolvedColumnRenameHint[] =>
  stableSort(
    entries,
    (entry) => `${entry.tableName}.${entry.fromColumnName}->${entry.toColumnName}`,
  );

export const collectRenameHints = (
  diff: DatabaseSnapshotDiff,
  explicitHints: MigrationRenameHints | undefined,
): CollectRenameHintsResult => {
  const diagnostics: MigrationDiagnostic[] = [];
  const tableRenamesByFrom = new Map<string, ResolvedTableRenameHint>();
  const tableRenamesByTo = new Map<string, ResolvedTableRenameHint>();
  const columnRenamesByFrom = new Map<string, ResolvedColumnRenameHint>();
  const columnRenamesByTo = new Map<string, ResolvedColumnRenameHint>();

  const addTableHint = (
    entry: Omit<ResolvedTableRenameHint, 'source'>,
    source: HintSource,
  ): void => {
    if (!entry.fromTableName || !entry.toTableName) {
      return;
    }
    if (entry.fromTableName === entry.toTableName) {
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'REDUNDANT_TABLE_RENAME_HINT',
          severity: source === 'explicit' ? 'error' : 'warning',
          message: `Table rename hint "${entry.fromTableName}" -> "${entry.toTableName}" is redundant.`,
          source: {
            table: entry.toTableName,
          },
        }),
      );
      return;
    }

    const resolved: ResolvedTableRenameHint = { ...entry, source };
    const existingFrom = tableRenamesByFrom.get(entry.fromTableName);
    if (
      existingFrom &&
      (existingFrom.toTableName !== entry.toTableName || existingFrom.source !== source)
    ) {
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'CONFLICTING_TABLE_RENAME_HINT',
          severity: source === 'explicit' ? 'error' : 'warning',
          message: `Conflicting table rename hints for "${entry.fromTableName}" (${existingFrom.toTableName} vs ${entry.toTableName}).`,
          source: {
            table: entry.toTableName,
          },
        }),
      );
      if (source === 'schema') {
        return;
      }
    }

    const existingTo = tableRenamesByTo.get(entry.toTableName);
    if (
      existingTo &&
      (existingTo.fromTableName !== entry.fromTableName || existingTo.source !== source)
    ) {
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'CONFLICTING_TABLE_RENAME_HINT',
          severity: source === 'explicit' ? 'error' : 'warning',
          message: `Conflicting table rename hints targeting "${entry.toTableName}" (${existingTo.fromTableName} vs ${entry.fromTableName}).`,
          source: {
            table: entry.toTableName,
          },
        }),
      );
      if (source === 'schema') {
        return;
      }
    }

    tableRenamesByFrom.set(entry.fromTableName, resolved);
    tableRenamesByTo.set(entry.toTableName, resolved);
  };

  const addColumnHint = (
    entry: Omit<ResolvedColumnRenameHint, 'source'>,
    source: HintSource,
  ): void => {
    if (!entry.fromColumnName || !entry.toColumnName) {
      return;
    }
    if (entry.fromColumnName === entry.toColumnName) {
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'REDUNDANT_COLUMN_RENAME_HINT',
          severity: source === 'explicit' ? 'error' : 'warning',
          message: `Column rename hint "${entry.tableName}.${entry.fromColumnName}" -> "${entry.tableName}.${entry.toColumnName}" is redundant.`,
          source: {
            table: entry.tableName,
            column: entry.toColumnName,
          },
        }),
      );
      return;
    }

    const fromKey = `${entry.tableName}.${entry.fromColumnName}`;
    const toKey = `${entry.tableName}.${entry.toColumnName}`;
    const resolved: ResolvedColumnRenameHint = { ...entry, source };
    const existingFrom = columnRenamesByFrom.get(fromKey);
    if (
      existingFrom &&
      (existingFrom.toColumnName !== entry.toColumnName || existingFrom.source !== source)
    ) {
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'CONFLICTING_COLUMN_RENAME_HINT',
          severity: source === 'explicit' ? 'error' : 'warning',
          message: `Conflicting column rename hints for "${fromKey}" (${existingFrom.toColumnName} vs ${entry.toColumnName}).`,
          source: {
            table: entry.tableName,
            column: entry.toColumnName,
          },
        }),
      );
      if (source === 'schema') {
        return;
      }
    }

    const existingTo = columnRenamesByTo.get(toKey);
    if (
      existingTo &&
      (existingTo.fromColumnName !== entry.fromColumnName || existingTo.source !== source)
    ) {
      diagnostics.push(
        createMigrationDiagnostic({
          code: 'CONFLICTING_COLUMN_RENAME_HINT',
          severity: source === 'explicit' ? 'error' : 'warning',
          message: `Conflicting column rename hints targeting "${toKey}" (${existingTo.fromColumnName} vs ${entry.fromColumnName}).`,
          source: {
            table: entry.tableName,
            column: entry.toColumnName,
          },
        }),
      );
      if (source === 'schema') {
        return;
      }
    }

    columnRenamesByFrom.set(fromKey, resolved);
    columnRenamesByTo.set(toKey, resolved);
  };

  for (const hint of explicitHints?.tableRenames ?? []) {
    addTableHint(hint, 'explicit');
  }
  for (const hint of explicitHints?.columnRenames ?? []) {
    addColumnHint(hint, 'explicit');
  }

  for (const hint of collectSchemaTableHints(diff)) {
    addTableHint(hint, 'schema');
  }
  for (const hint of collectSchemaColumnHints(diff)) {
    addColumnHint(hint, 'schema');
  }

  return {
    tableRenames: sortTableRenames([...tableRenamesByFrom.values()]),
    columnRenames: sortColumnRenames([...columnRenamesByFrom.values()]),
    diagnostics,
  };
};
