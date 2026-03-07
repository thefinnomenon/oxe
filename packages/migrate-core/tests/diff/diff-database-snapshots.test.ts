import { describe, expect, it } from 'vitest';

import { buildDatabaseSnapshot, diffDatabaseSnapshots } from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('diffDatabaseSnapshots', () => {
  it('returns empty diff when snapshots are identical', async () => {
    const graph = await loadFixtureSchemaGraph('e2e-a');
    const snapshot = buildDatabaseSnapshot(graph);

    const diff = diffDatabaseSnapshots(snapshot, snapshot);

    expect(diff.hasChanges).toBe(false);
    expect(diff.diagnostics).toEqual([]);
    expect(diff.changes.tablesCreated).toEqual([]);
    expect(diff.changes.columnsAdded).toEqual([]);
  });

  it('detects enum/table/column/constraint differences', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-b'));

    const diff = diffDatabaseSnapshots(previous, next);

    expect(diff.hasChanges).toBe(true);

    expect(diff.changes.enumValuesAppended).toHaveLength(1);
    expect(diff.changes.enumValuesAppended[0].enumName).toBe('PostStatus');
    expect(diff.changes.enumValuesAppended[0].appendedValues).toEqual(['archived']);

    expect(diff.changes.tablesCreated.map((change) => change.tableName)).toEqual(['Comment']);

    expect(
      diff.changes.columnsAdded.map((change) => `${change.tableName}.${change.columnName}`),
    ).toEqual(['Post.summary', 'User.bio']);

    expect(
      diff.changes.columnsRemoved.map((change) => `${change.tableName}.${change.columnName}`),
    ).toEqual(['Post.body']);

    expect(
      diff.changes.columnsDefaultChanged.map(
        (change) => `${change.tableName}.${change.columnName}`,
      ),
    ).toEqual(['Post.status']);

    expect(diff.changes.foreignKeysOnDeleteChanged.map((change) => change.foreignKeyName)).toEqual([
      'post_author_id_fkey',
    ]);

    expect(
      diff.changes.foreignKeysAdded.map((change) => `${change.tableName}.${change.foreignKeyName}`),
    ).toEqual(['Comment.comment_author_id_fkey', 'Comment.comment_post_id_fkey']);

    expect(diff.changes.foreignKeysRemoved).toEqual([]);
  });
});
