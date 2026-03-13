import { createStorageMigrationDiagnostic } from '../diagnostics/helpers.js';
import type { StorageMigrationDiagnostic } from '../diagnostics/types.js';
import type { StorageSnapshotDiff } from '../diff/types.js';
import type { StorageMigrationRenameHints } from './types.js';

export interface ResolvedBucketRenameHint {
  fromBucketName: string;
  toBucketName: string;
  source: 'explicit' | 'schema';
}

export interface CollectBucketRenameHintsResult {
  bucketRenames: ResolvedBucketRenameHint[];
  diagnostics: StorageMigrationDiagnostic[];
}

const sortHints = (hints: ResolvedBucketRenameHint[]): ResolvedBucketRenameHint[] =>
  [...hints].sort((left, right) =>
    `${left.fromBucketName}->${left.toBucketName}`.localeCompare(
      `${right.fromBucketName}->${right.toBucketName}`,
    ),
  );

export const collectBucketRenameHints = (
  diff: StorageSnapshotDiff,
  explicitHints: StorageMigrationRenameHints | undefined,
): CollectBucketRenameHintsResult => {
  const diagnostics: StorageMigrationDiagnostic[] = [];
  const hintsByFrom = new Map<string, ResolvedBucketRenameHint>();
  const hintsByTo = new Map<string, ResolvedBucketRenameHint>();

  const addHint = (
    hint: Omit<ResolvedBucketRenameHint, 'source'>,
    source: ResolvedBucketRenameHint['source'],
  ): void => {
    if (hint.fromBucketName === hint.toBucketName) {
      diagnostics.push(
        createStorageMigrationDiagnostic({
          code: 'REDUNDANT_BUCKET_RENAME_HINT',
          severity: source === 'explicit' ? 'error' : 'warning',
          message: `Bucket rename hint "${hint.fromBucketName}" -> "${hint.toBucketName}" is redundant.`,
          source: {
            bucket: hint.toBucketName,
          },
        }),
      );
      return;
    }

    const resolved = {
      ...hint,
      source,
    } satisfies ResolvedBucketRenameHint;

    const existingByFrom = hintsByFrom.get(hint.fromBucketName);
    if (existingByFrom && existingByFrom.toBucketName !== hint.toBucketName) {
      diagnostics.push(
        createStorageMigrationDiagnostic({
          code: 'CONFLICTING_BUCKET_RENAME_HINT',
          severity: source === 'explicit' ? 'error' : 'warning',
          message: `Conflicting bucket rename hints for "${hint.fromBucketName}" (${existingByFrom.toBucketName} vs ${hint.toBucketName}).`,
          source: {
            bucket: hint.toBucketName,
          },
        }),
      );
      if (source === 'schema') {
        return;
      }
    }

    const existingByTo = hintsByTo.get(hint.toBucketName);
    if (existingByTo && existingByTo.fromBucketName !== hint.fromBucketName) {
      diagnostics.push(
        createStorageMigrationDiagnostic({
          code: 'CONFLICTING_BUCKET_RENAME_HINT',
          severity: source === 'explicit' ? 'error' : 'warning',
          message: `Conflicting bucket rename hints targeting "${hint.toBucketName}" (${existingByTo.fromBucketName} vs ${hint.fromBucketName}).`,
          source: {
            bucket: hint.toBucketName,
          },
        }),
      );
      if (source === 'schema') {
        return;
      }
    }

    hintsByFrom.set(hint.fromBucketName, resolved);
    hintsByTo.set(hint.toBucketName, resolved);
  };

  for (const hint of explicitHints?.bucketRenames ?? []) {
    addHint(hint, 'explicit');
  }

  for (const created of diff.changes.bucketsCreated) {
    const renameFrom = created.next.renameFrom;
    if (!renameFrom) {
      continue;
    }

    addHint(
      {
        fromBucketName: renameFrom,
        toBucketName: created.bucketName,
      },
      'schema',
    );
  }

  return {
    bucketRenames: sortHints([...hintsByFrom.values()]),
    diagnostics,
  };
};
