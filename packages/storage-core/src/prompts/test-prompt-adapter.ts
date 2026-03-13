import type { AmbiguousBucketChange } from '../operations/bucket-ambiguity.js';
import type { BucketAmbiguityResolution } from '../operations/resolve-bucket-ambiguities.js';
import type { StoragePromptAdapter } from './types.js';

export interface TestStoragePromptAdapterInput {
  bucketResolutions?: BucketAmbiguityResolution[];
  confirmDestructive?: boolean;
}

export class TestStoragePromptAdapter implements StoragePromptAdapter {
  private readonly bucketResolutionsByName: Map<string, BucketAmbiguityResolution>;

  private readonly confirmValue: boolean;

  constructor(input: TestStoragePromptAdapterInput = {}) {
    this.bucketResolutionsByName = new Map(
      (input.bucketResolutions ?? []).map((entry) => [entry.missingBucketName, entry]),
    );
    this.confirmValue = input.confirmDestructive ?? false;
  }

  async chooseBucketResolution(change: AmbiguousBucketChange): Promise<BucketAmbiguityResolution> {
    const resolution = this.bucketResolutionsByName.get(change.missingBucketName);
    if (!resolution) {
      return {
        missingBucketName: change.missingBucketName,
        decision: 'deleted',
      };
    }

    return resolution;
  }

  async confirmDestructive(): Promise<boolean> {
    return this.confirmValue;
  }
}
