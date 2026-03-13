import { describe, expect, it } from 'vitest';

import { buildStorageSnapshot } from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('buildStorageSnapshot', () => {
  it('maps schema buckets into deterministic storage snapshot', async () => {
    const graph = await loadFixtureSchemaGraph('basic-a');
    const snapshot = buildStorageSnapshot(graph, { bucketPrefix: 'oxe-dev' });

    expect(snapshot.formatVersion).toBe(1);
    expect(Object.keys(snapshot.buckets)).toEqual(['PostAssets']);
    expect(snapshot.buckets.PostAssets.logicalName).toBe('PostAssets');
    expect(snapshot.buckets.PostAssets.providerBucketName).toBe('oxe-dev-postassets');
    expect(snapshot.buckets.PostAssets.metadata.mimeType).toEqual(['image/*']);
  });

  it('produces identical snapshot output for the same graph', async () => {
    const graph = await loadFixtureSchemaGraph('basic-a');
    const first = buildStorageSnapshot(graph, { bucketPrefix: 'oxe-dev' });
    const second = buildStorageSnapshot(graph, { bucketPrefix: 'oxe-dev' });

    expect(first).toEqual(second);
  });
});
