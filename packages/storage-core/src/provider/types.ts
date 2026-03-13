export interface StorageBucketDescriptor {
  name: string;
}

export interface CreateBucketOptions {
  name: string;
}

export interface DeleteBucketOptions {
  name: string;
}

export interface StorageProvider {
  bucketExists(name: string): Promise<boolean>;
  createBucket(options: CreateBucketOptions): Promise<void>;
  deleteBucket(options: DeleteBucketOptions): Promise<void>;
  listBuckets(): Promise<StorageBucketDescriptor[]>;
  isBucketEmpty(name: string): Promise<boolean>;
  emptyBucket(name: string): Promise<void>;
}
