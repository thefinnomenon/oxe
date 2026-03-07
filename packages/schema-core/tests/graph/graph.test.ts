import { describe, expect, it } from 'vitest';

import { buildSchemaGraph } from '../../src/index.js';
import { loadFixtureProject } from '../helpers.js';

describe('schema graph', () => {
  it('builds normalized graph with built-in fields and metadata', async () => {
    const project = await loadFixtureProject('basic');
    const graph = buildSchemaGraph(project);

    expect(graph.declarations.tables.sort()).toEqual(['Comment', 'Post', 'User']);

    const post = graph.tables.Post;
    expect(post).toBeDefined();
    expect(Object.keys(post.fields)).toEqual([
      'id',
      'createdAt',
      'updatedAt',
      'authorId',
      'title',
      'body',
      'status',
      'seo',
      'tags',
    ]);

    expect(post.fields.id.db.defaultValue).toBe('uuidv7');
    expect(post.fields.createdAt.db.defaultValue).toBe('now');
    expect(post.fields.updatedAt.db.autoUpdated).toBe(true);

    expect(post.fields.authorId.relationship).toEqual({
      targetTable: 'User',
      onDelete: undefined,
    });
    expect(post.ownerField).toBe('authorId');

    expect(post.auth.get).toEqual(['public']);
    expect(post.auth.getMany).toEqual(['public']);
    expect(post.auth.create).toEqual(['admin', 'owner']);
    expect(post.auth.update).toEqual(['admin', 'owner']);
    expect(post.auth.delete).toEqual(['admin', 'owner']);

    const assets = graph.buckets.Assets;
    expect(assets.metadata.mediaType).toBe('image');
    expect(assets.metadata.fileTypes).toEqual(['image/png', 'image/jpeg']);
    expect(assets.metadata.size).toEqual({ min: 1, max: 5_000_000 });
    expect(assets.metadata.dimensions).toEqual({
      min: { width: 300, height: 300 },
      max: { width: 3840, height: 2160 },
    });
    expect(assets.metadata.ttlSeconds).toBe(3600);

    expect(graph.provenance.tables.Post).toContain('/schemas/core.ts');
    expect(graph.provenance.tables.Comment).toContain('/schemas/comments.ts');
  });

  it('keeps diagnostics on the graph when validation fails', async () => {
    const project = await loadFixtureProject('invalid-object-type');
    const graph = buildSchemaGraph(project);

    expect(graph.diagnostics.length).toBeGreaterThan(0);
    expect(graph.diagnostics.some((diagnostic) => diagnostic.code === 'BUILT_IN_FIELD_OVERRIDE')).toBe(
      true,
    );
  });
});
