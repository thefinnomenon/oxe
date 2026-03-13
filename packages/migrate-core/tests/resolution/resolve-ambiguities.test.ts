import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  detectAmbiguousChanges,
  diffDatabaseSnapshots,
  resolveAmbiguities,
  TestPromptAdapter,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('resolveAmbiguities', () => {
  it('uses prompt adapter decisions for deleted vs renamed outcomes', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-b'));
    const ambiguities = detectAmbiguousChanges(diffDatabaseSnapshots(previous, next));

    const result = await resolveAmbiguities(ambiguities, {
      promptAdapter: new TestPromptAdapter({
        tableResolutions: [
          {
            missingTableName: 'User',
            decision: 'renamed',
            targetTableName: 'Account',
          },
        ],
        columnResolutions: [
          {
            tableName: 'Post',
            missingColumnName: 'title',
            decision: 'renamed',
            targetColumnName: 'headline',
          },
        ],
      }),
    });

    expect(result.unresolvedCount).toBe(0);
    expect(result.resolutions.tables).toEqual([
      {
        missingTableName: 'User',
        decision: 'renamed',
        targetTableName: 'Account',
      },
    ]);
    expect(result.resolutions.columns).toEqual([
      {
        tableName: 'Post',
        missingColumnName: 'title',
        decision: 'renamed',
        targetColumnName: 'headline',
      },
    ]);
  });

  it('fails in non-interactive mode when ambiguities are unresolved', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-b'));
    const ambiguities = detectAmbiguousChanges(diffDatabaseSnapshots(previous, next));

    const result = await resolveAmbiguities(ambiguities, { nonInteractive: true });
    expect(result.unresolvedCount).toBeGreaterThan(0);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'UNRESOLVED_TABLE_AMBIGUITY'),
    ).toBe(true);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'UNRESOLVED_COLUMN_AMBIGUITY'),
    ).toBe(true);
  });

  it('validates provided resolution targets', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-b'));
    const ambiguities = detectAmbiguousChanges(diffDatabaseSnapshots(previous, next));

    const result = await resolveAmbiguities(ambiguities, {
      providedResolutions: {
        tables: [
          {
            missingTableName: 'User',
            decision: 'renamed',
            targetTableName: 'DoesNotExist',
          },
        ],
      },
      nonInteractive: true,
    });
    expect(result.unresolvedCount).toBeGreaterThan(0);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === 'INVALID_TABLE_AMBIGUITY_RESOLUTION',
      ),
    ).toBe(true);
  });
});
