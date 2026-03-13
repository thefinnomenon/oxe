import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  planMigrationWithAmbiguityResolution,
  renderMigrationSql,
  TestPromptAdapter,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('planMigrationWithAmbiguityResolution', () => {
  it('blocks in non-interactive mode when ambiguity exists and no resolutions are provided', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-b'));
    const result = await planMigrationWithAmbiguityResolution(
      diffDatabaseSnapshots(previous, next),
      {
        nonInteractive: true,
      },
    );

    expect(result.plan.blocked).toBe(true);
    expect(result.plan.operations).toEqual([]);
    expect(
      result.plan.diagnostics.some(
        (diagnostic) => diagnostic.code === 'PLAN_BLOCKED_UNRESOLVED_AMBIGUITY',
      ),
    ).toBe(true);
  });

  it('supports explicit resolutions in non-interactive mode', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-b'));
    const result = await planMigrationWithAmbiguityResolution(
      diffDatabaseSnapshots(previous, next),
      {
        nonInteractive: true,
        allowDestructive: true,
        providedResolutions: {
          tables: [
            {
              missingTableName: 'User',
              decision: 'renamed',
              targetTableName: 'Account',
            },
          ],
          columns: [
            {
              tableName: 'Post',
              missingColumnName: 'title',
              decision: 'renamed',
              targetColumnName: 'headline',
            },
          ],
        },
      },
    );

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

    const sql = renderMigrationSql(result.plan, { abortOnBlockedPlan: false });
    expect(sql).toContain('ALTER TABLE "User" RENAME TO "Account";');
    expect(sql).toContain('ALTER TABLE "Post" RENAME COLUMN "title" TO "headline";');
  });

  it('supports multiple rename/delete decisions in one run', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('ambiguity-multi-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('ambiguity-multi-b'));
    const result = await planMigrationWithAmbiguityResolution(
      diffDatabaseSnapshots(previous, next),
      {
        allowDestructive: true,
        promptAdapter: new TestPromptAdapter({
          tableResolutions: [
            { missingTableName: 'User', decision: 'renamed', targetTableName: 'Player' },
            { missingTableName: 'Team', decision: 'renamed', targetTableName: 'Squad' },
            { missingTableName: 'Audit', decision: 'deleted' },
          ],
          columnResolutions: [
            {
              tableName: 'Profile',
              missingColumnName: 'fullName',
              decision: 'renamed',
              targetColumnName: 'displayName',
            },
            {
              tableName: 'Profile',
              missingColumnName: 'handle',
              decision: 'renamed',
              targetColumnName: 'username',
            },
          ],
        }),
      },
    );

    expect(result.plan.blocked).toBe(false);
    expect(result.plan.operations.some((operation) => operation.kind === 'rename_table')).toBe(
      true,
    );
    expect(result.plan.operations.some((operation) => operation.kind === 'rename_column')).toBe(
      true,
    );
    expect(
      result.plan.operations.some(
        (operation) => operation.kind === 'drop_table' && operation.table.name === 'Audit',
      ),
    ).toBe(true);
  });
});
