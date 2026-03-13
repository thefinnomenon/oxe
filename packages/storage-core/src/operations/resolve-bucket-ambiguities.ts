import { createStorageMigrationDiagnostic } from '../diagnostics/helpers.js';
import type { StorageMigrationDiagnostic } from '../diagnostics/types.js';
import type { StoragePromptAdapter } from '../prompts/types.js';
import type { AmbiguousBucketChange } from './bucket-ambiguity.js';

export interface BucketAmbiguityResolution {
  missingBucketName: string;
  decision: 'deleted' | 'renamed';
  targetBucketName?: string;
}

export interface BucketAmbiguityResolutions {
  buckets: BucketAmbiguityResolution[];
}

export interface ResolveBucketAmbiguitiesResult {
  resolutions: BucketAmbiguityResolutions;
  diagnostics: StorageMigrationDiagnostic[];
  unresolvedCount: number;
}

export const resolveBucketAmbiguities = async (
  ambiguities: AmbiguousBucketChange[],
  options: {
    promptAdapter?: StoragePromptAdapter;
    nonInteractive?: boolean;
    providedResolutions?: Partial<BucketAmbiguityResolutions>;
  } = {},
): Promise<ResolveBucketAmbiguitiesResult> => {
  const diagnostics: StorageMigrationDiagnostic[] = [];
  const resolutionsByBucket = new Map<string, BucketAmbiguityResolution>();

  for (const resolution of options.providedResolutions?.buckets ?? []) {
    resolutionsByBucket.set(resolution.missingBucketName, resolution);
  }

  const usedTargets = new Set<string>();
  const resolved: BucketAmbiguityResolution[] = [];
  let unresolvedCount = 0;

  for (const ambiguity of ambiguities) {
    let resolution = resolutionsByBucket.get(ambiguity.missingBucketName);

    if (!resolution && !options.nonInteractive && options.promptAdapter) {
      resolution = await options.promptAdapter.chooseBucketResolution(ambiguity);
    }

    if (!resolution) {
      unresolvedCount += 1;
      diagnostics.push(
        createStorageMigrationDiagnostic({
          code: 'UNRESOLVED_BUCKET_AMBIGUITY',
          severity: 'error',
          message: `Bucket "${ambiguity.missingBucketName}" is ambiguous (deleted vs renamed) and requires explicit resolution.`,
          source: {
            bucket: ambiguity.missingBucketName,
          },
        }),
      );
      continue;
    }

    if (resolution.decision === 'renamed') {
      const candidateNames = new Set(ambiguity.candidates.map((candidate) => candidate.bucketName));
      const target = resolution.targetBucketName;
      if (!target || !candidateNames.has(target)) {
        unresolvedCount += 1;
        diagnostics.push(
          createStorageMigrationDiagnostic({
            code: 'INVALID_BUCKET_AMBIGUITY_RESOLUTION',
            severity: 'error',
            message: `Invalid rename target "${target ?? '<missing>'}" for bucket "${ambiguity.missingBucketName}".`,
            source: {
              bucket: ambiguity.missingBucketName,
            },
          }),
        );
        continue;
      }

      if (usedTargets.has(target)) {
        unresolvedCount += 1;
        diagnostics.push(
          createStorageMigrationDiagnostic({
            code: 'DUPLICATE_BUCKET_RENAME_TARGET',
            severity: 'error',
            message: `Bucket rename target "${target}" was selected more than once.`,
            source: {
              bucket: ambiguity.missingBucketName,
            },
          }),
        );
        continue;
      }

      usedTargets.add(target);
    }

    resolved.push(resolution);
  }

  return {
    resolutions: {
      buckets: resolved.sort((left, right) =>
        left.missingBucketName.localeCompare(right.missingBucketName),
      ),
    },
    diagnostics,
    unresolvedCount,
  };
};
