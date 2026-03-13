import {
  type CreateBucketCommandInput,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

import type {
  CreateBucketOptions,
  DeleteBucketOptions,
  StorageBucketDescriptor,
  StorageProvider,
} from '../provider/types.js';
import type { S3CompatibleProviderConfig } from './types.js';

const isNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  if (metadata?.httpStatusCode === 404) {
    return true;
  }

  const name = (error as { name?: string }).name;
  return name === 'NotFound' || name === 'NoSuchBucket';
};

export class S3CompatibleStorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly config: S3CompatibleProviderConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      },
    });
  }

  async bucketExists(name: string): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: name }));
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  async createBucket(options: CreateBucketOptions): Promise<void> {
    const input: CreateBucketCommandInput = {
      Bucket: options.name,
    };

    if (this.config.region && this.config.region !== 'us-east-1') {
      input.CreateBucketConfiguration = {
        LocationConstraint: this.config.region as NonNullable<
          CreateBucketCommandInput['CreateBucketConfiguration']
        >['LocationConstraint'],
      };
    }

    await this.client.send(new CreateBucketCommand(input));
  }

  async deleteBucket(options: DeleteBucketOptions): Promise<void> {
    await this.client.send(
      new DeleteBucketCommand({
        Bucket: options.name,
      }),
    );
  }

  async listBuckets(): Promise<StorageBucketDescriptor[]> {
    const response = await this.client.send(new ListBucketsCommand({}));
    return (response.Buckets ?? [])
      .map((entry) => ({ name: entry.Name ?? '' }))
      .filter((entry) => entry.name.length > 0)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async isBucketEmpty(name: string): Promise<boolean> {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: name,
        MaxKeys: 1,
      }),
    );

    return (response.KeyCount ?? 0) === 0;
  }

  async emptyBucket(name: string): Promise<void> {
    let continuationToken: string | undefined;

    for (;;) {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: name,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );

      const keys = (page.Contents ?? [])
        .map((entry) => entry.Key)
        .filter((key): key is string => Boolean(key));

      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: name,
            Delete: {
              Objects: keys.map((key) => ({ Key: key })),
              Quiet: true,
            },
          }),
        );
      }

      if (!page.IsTruncated) {
        break;
      }

      continuationToken = page.NextContinuationToken;
      if (!continuationToken) {
        break;
      }
    }
  }
}
