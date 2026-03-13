import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  planMigrationWithAmbiguityResolution,
  renderMigrationSql,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('rename with shape changes', () => {
  it('handles table rename plus add/drop columns in one migration after resolution', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-with-changes-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-with-changes-b'));

    const result = await planMigrationWithAmbiguityResolution(
      diffDatabaseSnapshots(previous, next),
      {
        allowDestructive: true,
        nonInteractive: true,
        providedResolutions: {
          tables: [
            {
              missingTableName: 'User',
              decision: 'renamed',
              targetTableName: 'Player',
            },
          ],
          columns: [
            {
              tableName: 'Player',
              missingColumnName: 'fullName',
              decision: 'renamed',
              targetColumnName: 'displayName',
            },
            {
              tableName: 'Player',
              missingColumnName: 'age',
              decision: 'deleted',
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
    expect(
      result.plan.operations.some(
        (operation) =>
          operation.kind === 'add_column' &&
          operation.tableName === 'Player' &&
          operation.column.name === 'nickname',
      ),
    ).toBe(true);
    expect(
      result.plan.operations.some(
        (operation) =>
          operation.kind === 'drop_column' &&
          operation.tableName === 'Player' &&
          operation.column.name === 'age',
      ),
    ).toBe(true);

    const sql = renderMigrationSql(result.plan, { abortOnBlockedPlan: false });
    expect(sql).toContain('ALTER TABLE "User" RENAME TO "Player";');
    expect(sql).toContain('ALTER TABLE "Player" RENAME COLUMN "fullName" TO "displayName";');
    expect(sql).toContain('ALTER TABLE "Player" ADD COLUMN "nickname" text NULL;');
    expect(sql).toContain('ALTER TABLE "Player" DROP COLUMN "age";');
  });
});
