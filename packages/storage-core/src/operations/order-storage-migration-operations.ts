import type { StorageMigrationOperation } from './types.js';

const PRIORITY: Record<StorageMigrationOperation['kind'], number> = {
  create_bucket: 10,
  rename_bucket: 20,
  warn_bucket_metadata_change: 30,
  delete_bucket: 40,
};

const identity = (operation: StorageMigrationOperation): string => {
  switch (operation.kind) {
    case 'create_bucket':
    case 'delete_bucket':
      return operation.providerBucketName;
    case 'rename_bucket':
      return `${operation.fromProviderBucketName}->${operation.toProviderBucketName}`;
    case 'warn_bucket_metadata_change':
      return operation.bucketName;
    default: {
      const exhaustive: never = operation;
      return JSON.stringify(exhaustive);
    }
  }
};

export const orderStorageMigrationOperations = (
  operations: StorageMigrationOperation[],
): StorageMigrationOperation[] => {
  return [...operations].sort((left, right) => {
    const priorityOrder = PRIORITY[left.kind] - PRIORITY[right.kind];
    if (priorityOrder !== 0) {
      return priorityOrder;
    }

    return identity(left).localeCompare(identity(right));
  });
};
