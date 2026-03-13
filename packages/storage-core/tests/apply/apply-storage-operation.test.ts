import { describe, expect, it } from 'vitest';

import type { StorageProvider } from '../../src/provider/index.js';
import { applyStorageOperation } from '../../src/apply/apply-storage-migrations.js';
import type { StorageMigrationOperation } from '../../src/operations/index.js';

class FakeStorageProvider implements StorageProvider {
  public readonly buckets = new Set<string>();

  public readonly nonEmptyBuckets = new Set<string>();

  async bucketExists(name: string): Promise<boolean> {
    return this.buckets.has(name);
  }

  async createBucket(options: { name: string }): Promise<void> {
    this.buckets.add(options.name);
  }

  async deleteBucket(options: { name: string }): Promise<void> {
    this.buckets.delete(options.name);
    this.nonEmptyBuckets.delete(options.name);
  }

  async listBuckets(): Promise<Array<{ name: string }>> {
    return [...this.buckets].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
  }

  async isBucketEmpty(name: string): Promise<boolean> {
    return !this.nonEmptyBuckets.has(name);
  }

  async emptyBucket(name: string): Promise<void> {
    this.nonEmptyBuckets.delete(name);
  }
}

const createOperation = (name: string): StorageMigrationOperation => ({
  kind: 'create_bucket',
  bucketName: name,
  providerBucketName: name,
  bucket: {
    logicalName: name,
    providerBucketName: name,
    sourcePath: '',
    metadata: { mimeType: [], size: {}, duration: {}, dimensions: {} },
  },
});

describe('applyStorageOperation', () => {
  it('creates buckets idempotently', async () => {
    const provider = new FakeStorageProvider();

    await applyStorageOperation(createOperation('a-bucket'), provider, false);
    await applyStorageOperation(createOperation('a-bucket'), provider, false);

    expect(provider.buckets.has('a-bucket')).toBe(true);
  });

  it('fails deleting non-empty bucket without force', async () => {
    const provider = new FakeStorageProvider();
    provider.buckets.add('to-delete');
    provider.nonEmptyBuckets.add('to-delete');

    await expect(
      applyStorageOperation(
        {
          kind: 'delete_bucket',
          bucketName: 'ToDelete',
          providerBucketName: 'to-delete',
          bucket: {
            logicalName: 'ToDelete',
            providerBucketName: 'to-delete',
            sourcePath: '',
            metadata: { mimeType: [], size: {}, duration: {}, dimensions: {} },
          },
        },
        provider,
        false,
      ),
    ).rejects.toThrow('Refusing to delete non-empty bucket');
  });

  it('force deletes non-empty bucket by emptying first', async () => {
    const provider = new FakeStorageProvider();
    provider.buckets.add('to-delete');
    provider.nonEmptyBuckets.add('to-delete');

    await applyStorageOperation(
      {
        kind: 'delete_bucket',
        bucketName: 'ToDelete',
        providerBucketName: 'to-delete',
        bucket: {
          logicalName: 'ToDelete',
          providerBucketName: 'to-delete',
          sourcePath: '',
          metadata: { mimeType: [], size: {}, duration: {}, dimensions: {} },
        },
      },
      provider,
      true,
    );

    expect(provider.buckets.has('to-delete')).toBe(false);
  });

  it('applies rename as create-new-keep-old strategy', async () => {
    const provider = new FakeStorageProvider();
    provider.buckets.add('old-bucket');

    await applyStorageOperation(
      {
        kind: 'rename_bucket',
        fromBucketName: 'OldBucket',
        toBucketName: 'NewBucket',
        fromProviderBucketName: 'old-bucket',
        toProviderBucketName: 'new-bucket',
        strategy: 'create_new_keep_old',
      },
      provider,
      false,
    );

    expect(provider.buckets.has('old-bucket')).toBe(true);
    expect(provider.buckets.has('new-bucket')).toBe(true);
  });
});
