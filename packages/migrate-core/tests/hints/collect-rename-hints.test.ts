import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  collectRenameHints,
  diffDatabaseSnapshots,
  generateMigrationPlan,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('collectRenameHints', () => {
  it('collects schema-authored table/column rename hints from next snapshot', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-schema-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-schema-b'));
    const diff = diffDatabaseSnapshots(previous, next);

    const collected = collectRenameHints(diff, undefined);
    expect(collected.tableRenames).toEqual([
      {
        fromTableName: 'User',
        toTableName: 'Account',
        source: 'schema',
      },
    ]);
    expect(collected.columnRenames).toEqual([
      {
        tableName: 'Post',
        fromColumnName: 'title',
        toColumnName: 'headline',
        source: 'schema',
      },
    ]);
  });

  it('emits diagnostics for conflicting explicit rename hints', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-b'));
    const diff = diffDatabaseSnapshots(previous, next);

    const collected = collectRenameHints(diff, {
      tableRenames: [
        { fromTableName: 'User', toTableName: 'Account' },
        { fromTableName: 'User', toTableName: 'Profile' },
      ],
    });

    expect(
      collected.diagnostics.some((entry) => entry.code === 'CONFLICTING_TABLE_RENAME_HINT'),
    ).toBe(true);
    expect(collected.diagnostics.some((entry) => entry.severity === 'error')).toBe(true);
  });

  it('blocks plan generation for invalid explicit rename hints', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-b'));
    const diff = diffDatabaseSnapshots(previous, next);

    const plan = generateMigrationPlan(diff, {
      renameHints: {
        tableRenames: [{ fromTableName: 'User', toTableName: 'NotARealTable' }],
      },
    });

    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics.some((entry) => entry.code === 'INVALID_TABLE_RENAME_HINT')).toBe(true);
  });
});
