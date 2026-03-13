import { describe, expect, it } from 'vitest';

import {
  buildStorageSnapshot,
  diffStorageSnapshots,
  generateStorageMigrationPlan,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('generateStorageMigrationPlan', () => {
  it('blocks in non-interactive mode for unresolved bucket rename ambiguity', async () => {
    const previous = buildStorageSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildStorageSnapshot(await loadFixtureSchemaGraph('rename-b'));

    const plan = await generateStorageMigrationPlan(diffStorageSnapshots(previous, next), {
      nonInteractive: true,
      allowDestructive: true,
    });

    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics.some((entry) => entry.code === 'UNRESOLVED_BUCKET_AMBIGUITY')).toBe(
      true,
    );
  });

  it('uses explicit rename hints to produce rename operations', async () => {
    const previous = buildStorageSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildStorageSnapshot(await loadFixtureSchemaGraph('rename-b'));

    const plan = await generateStorageMigrationPlan(diffStorageSnapshots(previous, next), {
      nonInteractive: true,
      allowDestructive: true,
      renameHints: {
        bucketRenames: [{ fromBucketName: 'UserAvatar', toBucketName: 'Avatar' }],
      },
    });

    expect(plan.blocked).toBe(false);
    expect(plan.operations.some((entry) => entry.kind === 'rename_bucket')).toBe(true);
    expect(plan.operations.some((entry) => entry.kind === 'create_bucket')).toBe(false);
    expect(plan.operations.some((entry) => entry.kind === 'delete_bucket')).toBe(false);
  });

  it('uses schema renameFrom hints in non-interactive mode', async () => {
    const previous = buildStorageSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildStorageSnapshot(await loadFixtureSchemaGraph('rename-hinted-b'));

    const plan = await generateStorageMigrationPlan(diffStorageSnapshots(previous, next), {
      nonInteractive: true,
      allowDestructive: true,
    });

    expect(plan.blocked).toBe(false);
    expect(plan.operations.some((entry) => entry.kind === 'rename_bucket')).toBe(true);
  });

  it('blocks destructive bucket deletes unless explicitly allowed', async () => {
    const previous = buildStorageSnapshot(await loadFixtureSchemaGraph('basic-a'));
    const next = buildStorageSnapshot(await loadFixtureSchemaGraph('empty'));

    const plan = await generateStorageMigrationPlan(diffStorageSnapshots(previous, next), {
      nonInteractive: true,
    });

    expect(plan.blocked).toBe(true);
    expect(plan.operations.some((entry) => entry.kind === 'delete_bucket')).toBe(true);
  });
});
