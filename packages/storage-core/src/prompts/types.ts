import type { AmbiguousBucketChange } from '../operations/bucket-ambiguity.js';
import type { BucketAmbiguityResolution } from '../operations/resolve-bucket-ambiguities.js';

export interface StoragePromptAdapter {
  chooseBucketResolution(change: AmbiguousBucketChange): Promise<BucketAmbiguityResolution>;
  confirmDestructive?(): Promise<boolean>;
}
