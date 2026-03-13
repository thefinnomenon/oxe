import { describe, expect, it } from 'vitest';

import { buildDatabaseSnapshot } from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('buildDatabaseSnapshot', () => {
  it('maps schema graph tables/enums/fields to normalized DB snapshot', async () => {
    const graph = await loadFixtureSchemaGraph('e2e-a');
    const snapshot = buildDatabaseSnapshot(graph);

    expect(snapshot.formatVersion).toBe(1);
    expect(Object.keys(snapshot.enums)).toEqual(['PostStatus']);
    expect(snapshot.enums.PostStatus.dbName).toBe('enum_post_status');
    expect(snapshot.enums.PostStatus.values).toEqual(['draft', 'published']);

    expect(Object.keys(snapshot.tables)).toEqual(['Post', 'User']);

    const post = snapshot.tables.Post;
    expect(post.dbName).toBe('app_posts');
    expect(post.primaryKey?.columns).toEqual(['id']);
    expect(post.primaryKey?.name).toBe('app_posts_pkey');

    expect(post.columns.id.postgresType).toBe('uuid');
    expect(post.columns.createdAt.postgresType).toBe('timestamptz');
    expect(post.columns.updatedAt.postgresType).toBe('timestamptz');

    expect(post.columns.status.enumDbName).toBe('enum_post_status');
    expect(post.columns.status.default).toEqual({
      kind: 'literal',
      value: 'draft',
    });

    expect(post.columns.tags.postgresType).toBe('text');
    expect(post.columns.tags.isArray).toBe(true);

    // v1 behavior: object and object[] fields map to jsonb columns.
    expect(post.columns.metadata.postgresType).toBe('jsonb');
    expect(post.columns.metadata.isArray).toBe(false);
    expect(post.columns.metadataHistory.postgresType).toBe('jsonb');
    expect(post.columns.metadataHistory.isArray).toBe(false);

    expect(Object.keys(post.foreignKeys)).toEqual(['app_posts_author_id_fkey']);
    expect(post.foreignKeys.app_posts_author_id_fkey.referencedTable).toBe('app_users');

    expect(Object.keys(post.indexes)).toContain('app_posts_author_id_idx');
  });
});
