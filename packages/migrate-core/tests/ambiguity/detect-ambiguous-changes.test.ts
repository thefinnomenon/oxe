import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  detectAmbiguousChanges,
  diffDatabaseSnapshots,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('detectAmbiguousChanges', () => {
  it('detects table and column ambiguities with ranked candidates', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-b'));

    const diff = diffDatabaseSnapshots(previous, next);
    const ambiguities = detectAmbiguousChanges(diff);

    expect(ambiguities.tables).toHaveLength(1);
    expect(ambiguities.tables[0].missingTableName).toBe('User');
    expect(ambiguities.tables[0].candidates.map((candidate) => candidate.tableName)).toEqual([
      'Account',
    ]);

    expect(ambiguities.columns).toHaveLength(1);
    expect(ambiguities.columns[0].tableName).toBe('Post');
    expect(ambiguities.columns[0].missingColumnName).toBe('title');
    expect(ambiguities.columns[0].candidates.map((candidate) => candidate.columnName)).toEqual([
      'headline',
    ]);
  });

  it('detects multiple ambiguous tables and columns in one diff', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('ambiguity-multi-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('ambiguity-multi-b'));
    const ambiguities = detectAmbiguousChanges(diffDatabaseSnapshots(previous, next));

    expect(ambiguities.tables.length).toBeGreaterThan(1);
    expect(
      ambiguities.tables.find((entry) => entry.missingTableName === 'User')?.candidates.length,
    ).toBe(3);
    expect(
      ambiguities.columns.find((entry) => entry.tableName === 'Profile')?.candidates.length,
    ).toBe(2);
  });

  it('does not report ambiguity for pure create flow', async () => {
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const ambiguities = detectAmbiguousChanges(diffDatabaseSnapshots(null, next));
    expect(ambiguities.tables).toEqual([]);
    expect(ambiguities.columns).toEqual([]);
  });
});
