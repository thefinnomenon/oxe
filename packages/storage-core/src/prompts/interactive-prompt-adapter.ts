import { createInterface } from 'node:readline/promises';

import type { AmbiguousBucketChange } from '../operations/bucket-ambiguity.js';
import type { BucketAmbiguityResolution } from '../operations/resolve-bucket-ambiguities.js';
import type { StoragePromptAdapter } from './types.js';

const parseSelection = (input: string): number | undefined => {
  const value = Number.parseInt(input.trim(), 10);
  if (!Number.isInteger(value)) {
    return undefined;
  }
  return value;
};

export class InteractiveStoragePromptAdapter implements StoragePromptAdapter {
  async chooseBucketResolution(change: AmbiguousBucketChange): Promise<BucketAmbiguityResolution> {
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log(`\nBucket "${change.missingBucketName}" no longer exists.`);
      console.log('Choose a replacement bucket, or select 0 if it was deleted:');
      console.log('  0) Deleted');
      for (let index = 0; index < change.candidates.length; index += 1) {
        const candidate = change.candidates[index];
        console.log(`  ${index + 1}) ${candidate.bucketName}`);
      }

      for (;;) {
        const answer = await reader.question(
          `Selection for "${change.missingBucketName}" [0-${change.candidates.length}]: `,
        );
        const selected = parseSelection(answer);
        if (selected === undefined || selected < 0 || selected > change.candidates.length) {
          console.log('Invalid selection. Enter a number from the list.');
          continue;
        }

        if (selected === 0) {
          return {
            missingBucketName: change.missingBucketName,
            decision: 'deleted',
          };
        }

        const candidate = change.candidates[selected - 1];
        return {
          missingBucketName: change.missingBucketName,
          decision: 'renamed',
          targetBucketName: candidate.bucketName,
        };
      }
    } finally {
      reader.close();
    }
  }

  async confirmDestructive(): Promise<boolean> {
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const answer = await reader.question(
        'This storage migration includes destructive bucket changes. Continue anyway? [y/N] ',
      );
      return ['y', 'yes'].includes(answer.trim().toLowerCase());
    } finally {
      reader.close();
    }
  }
}
