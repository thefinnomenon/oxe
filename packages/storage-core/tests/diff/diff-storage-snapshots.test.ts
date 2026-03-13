import { describe, expect, it } from 'vitest';

import { buildStorageSnapshot, diffStorageSnapshots } from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('diffStorageSnapshots', () => {
  it('detects bucket creation and metadata changes', async () => {
    const previous = buildStorageSnapshot(await loadFixtureSchemaGraph('basic-a'));
    const next = buildStorageSnapshot(await loadFixtureSchemaGraph('basic-b'));

    const diff = diffStorageSnapshots(previous, next);

    expect(diff.hasChanges).toBe(true);
    expect(diff.changes.bucketsCreated.map((change) => change.bucketName)).toEqual(['UserUploads']);
    expect(diff.changes.bucketsRemoved).toEqual([]);
    expect(diff.changes.bucketsMetadataChanged.map((change) => change.bucketName)).toEqual([
      'PostAssets',
    ]);
  });

  it('detects rename-like add/remove patterns conservatively', async () => {
    const previous = buildStorageSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildStorageSnapshot(await loadFixtureSchemaGraph('rename-b'));

    const diff = diffStorageSnapshots(previous, next);

    expect(diff.changes.bucketsCreated.map((change) => change.bucketName)).toEqual(['Avatar']);
    expect(diff.changes.bucketsRemoved.map((change) => change.bucketName)).toEqual(['UserAvatar']);
  });
});
