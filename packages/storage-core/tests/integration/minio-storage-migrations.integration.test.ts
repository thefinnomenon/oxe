import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyStorageMigrations,
  serializeStorageMigrationPlan,
  S3CompatibleStorageProvider,
} from '../../src/index.js';
import { getTestDatabaseUrl, getTestMinioConfig } from '../helpers.js';

const minioConfig = getTestMinioConfig();
const databaseUrl = getTestDatabaseUrl();
const maybeDescribe = minioConfig && databaseUrl ? describe : describe.skip;

maybeDescribe('storage migrations against MinIO (integration)', () => {
  let rootDir = '';
  let migrationsDir = '';
  let bucketName = '';
  let provider: S3CompatibleStorageProvider;
  let s3Client: S3Client;

  beforeAll(async () => {
    const token = Math.random().toString(36).slice(2, 10);
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'oxe-storage-'));
    migrationsDir = path.join(rootDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    bucketName = `oxe-storage-${token}`;
    provider = new S3CompatibleStorageProvider(minioConfig as NonNullable<typeof minioConfig>);
    s3Client = new S3Client({
      endpoint: minioConfig?.endpoint,
      region: minioConfig?.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: minioConfig?.accessKeyId ?? '',
        secretAccessKey: minioConfig?.secretAccessKey ?? '',
      },
    });
  });

  afterAll(async () => {
    if (provider && bucketName) {
      const exists = await provider.bucketExists(bucketName);
      if (exists) {
        await provider.emptyBucket(bucketName);
        await provider.deleteBucket({ name: bucketName });
      }
    }

    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('applies create and guarded delete storage migrations', async () => {
    const token = Math.random().toString(36).slice(2, 8);
    const createFile = path.join(migrationsDir, `0001_${token}_create.storage.json`);
    const createPlan = {
      blocked: false,
      diagnostics: [],
      operations: [
        {
          kind: 'create_bucket' as const,
          bucketName: 'UploadBucket',
          providerBucketName: bucketName,
          bucket: {
            logicalName: 'UploadBucket',
            providerBucketName: bucketName,
            sourcePath: '',
            metadata: { mimeType: [], size: {}, duration: {}, dimensions: {} },
          },
        },
      ],
    };

    await writeFile(createFile, serializeStorageMigrationPlan(createPlan), 'utf8');

    const createResult = await applyStorageMigrations({
      rootDir,
      connectionString: databaseUrl,
      provider,
    });
    expect(createResult.appliedCount).toBe(1);
    expect(await provider.bucketExists(bucketName)).toBe(true);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: 'hello.txt',
        Body: 'hello',
      }),
    );

    const deleteFile = path.join(migrationsDir, `0002_${token}_delete.storage.json`);
    const deletePlan = {
      blocked: false,
      diagnostics: [],
      operations: [
        {
          kind: 'delete_bucket' as const,
          bucketName: 'UploadBucket',
          providerBucketName: bucketName,
          bucket: {
            logicalName: 'UploadBucket',
            providerBucketName: bucketName,
            sourcePath: '',
            metadata: { mimeType: [], size: {}, duration: {}, dimensions: {} },
          },
        },
      ],
    };

    await writeFile(deleteFile, serializeStorageMigrationPlan(deletePlan), 'utf8');

    await expect(
      applyStorageMigrations({
        rootDir,
        connectionString: databaseUrl,
        provider,
      }),
    ).rejects.toThrow('Refusing to delete non-empty bucket');

    const deleteResult = await applyStorageMigrations({
      rootDir,
      connectionString: databaseUrl,
      provider,
      forceDeleteNonEmptyBuckets: true,
    });

    expect(deleteResult.appliedCount).toBe(1);
    expect(await provider.bucketExists(bucketName)).toBe(false);
  });
});
