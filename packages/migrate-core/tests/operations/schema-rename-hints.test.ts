import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  planMigrationWithAmbiguityResolution,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('schema-level rename hints', () => {
  it('uses table/column renameFrom hints in non-interactive planning', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-schema-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-schema-b'));
    const diff = diffDatabaseSnapshots(previous, next);

    const result = await planMigrationWithAmbiguityResolution(diff, {
      nonInteractive: true,
      allowDestructive: true,
    });

    expect(result.plan.blocked).toBe(false);
    expect(result.plan.operations.some((operation) => operation.kind === 'rename_table')).toBe(
      true,
    );
    expect(result.plan.operations.some((operation) => operation.kind === 'rename_column')).toBe(
      true,
    );
    expect(result.plan.operations.some((operation) => operation.kind === 'drop_table')).toBe(false);
    expect(result.plan.operations.some((operation) => operation.kind === 'create_table')).toBe(
      false,
    );
  });
});
