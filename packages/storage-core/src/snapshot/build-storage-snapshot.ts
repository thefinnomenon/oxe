import type { SchemaGraph } from '@oxe/schema-core';

import { buildProviderBucketName } from './naming.js';
import {
  STORAGE_SNAPSHOT_FORMAT_VERSION,
  type BuildStorageSnapshotOptions,
  type StorageSnapshot,
} from './types.js';

const sortRecordByKey = <TValue>(record: Record<string, TValue>): Record<string, TValue> =>
  Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));

export const buildStorageSnapshot = (
  schemaGraph: SchemaGraph,
  options: BuildStorageSnapshotOptions = {},
): StorageSnapshot => {
  const usedProviderNames = new Map<string, string>();
  const buckets: StorageSnapshot['buckets'] = {};

  for (const [bucketName, bucket] of Object.entries(schemaGraph.buckets).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const providerBucketName = buildProviderBucketName(bucketName, options.bucketPrefix);
    const existingBucket = usedProviderNames.get(providerBucketName);
    if (existingBucket && existingBucket !== bucketName) {
      throw new Error(
        `Bucket naming collision: schema buckets "${existingBucket}" and "${bucketName}" both map to provider bucket name "${providerBucketName}". Adjust names or prefix.`,
      );
    }

    usedProviderNames.set(providerBucketName, bucketName);
    buckets[bucketName] = {
      logicalName: bucketName,
      providerBucketName,
      renameFrom: bucket.renameFrom,
      sourcePath: bucket.sourcePath,
      metadata: {
        mimeType: [...bucket.metadata.mimeType],
        size: { ...bucket.metadata.size },
        duration: { ...bucket.metadata.duration },
        dimensions: {
          min: bucket.metadata.dimensions.min ? { ...bucket.metadata.dimensions.min } : undefined,
          max: bucket.metadata.dimensions.max ? { ...bucket.metadata.dimensions.max } : undefined,
        },
        ttlSeconds: bucket.metadata.ttlSeconds,
        fileNamePolicy: bucket.metadata.fileNamePolicy
          ? { ...bucket.metadata.fileNamePolicy }
          : undefined,
        postUpload: bucket.metadata.postUpload
          ? {
              optimizeImages: bucket.metadata.postUpload.optimizeImages
                ? {
                    ...bucket.metadata.postUpload.optimizeImages,
                    formats: bucket.metadata.postUpload.optimizeImages.formats
                      ? [...bucket.metadata.postUpload.optimizeImages.formats]
                      : undefined,
                  }
                : undefined,
              imageResize: bucket.metadata.postUpload.imageResize
                ? {
                    ...bucket.metadata.postUpload.imageResize,
                    variants: bucket.metadata.postUpload.imageResize.variants?.map((variant) => ({
                      ...variant,
                    })),
                  }
                : undefined,
              placeholders: bucket.metadata.postUpload.placeholders
                ? { ...bucket.metadata.postUpload.placeholders }
                : undefined,
              responsiveImages: bucket.metadata.postUpload.responsiveImages
                ? {
                    ...bucket.metadata.postUpload.responsiveImages,
                    breakpoints: [...bucket.metadata.postUpload.responsiveImages.breakpoints],
                    formats: bucket.metadata.postUpload.responsiveImages.formats
                      ? [...bucket.metadata.postUpload.responsiveImages.formats]
                      : undefined,
                  }
                : undefined,
            }
          : undefined,
      },
    };
  }

  return {
    formatVersion: STORAGE_SNAPSHOT_FORMAT_VERSION,
    generatedFromRootDir: schemaGraph.rootDir,
    naming: {
      bucketPrefix: options.bucketPrefix,
    },
    buckets: sortRecordByKey(buckets),
  };
};
