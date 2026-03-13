import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  generateMigrationPlan,
  renderMigrationSql,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('rename hints', () => {
  it('generates rename operations from explicit table/column hints', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('rename-b'));
    const diff = diffDatabaseSnapshots(previous, next);

    const plan = generateMigrationPlan(diff, {
      allowDestructive: true,
      renameHints: {
        tableRenames: [{ fromTableName: 'User', toTableName: 'Account' }],
        columnRenames: [{ tableName: 'Post', fromColumnName: 'title', toColumnName: 'headline' }],
      },
    });

    expect(plan.operations.some((operation) => operation.kind === 'rename_table')).toBe(true);
    expect(plan.operations.some((operation) => operation.kind === 'rename_column')).toBe(true);
    expect(plan.operations.some((operation) => operation.kind === 'drop_table')).toBe(false);
    expect(plan.operations.some((operation) => operation.kind === 'create_table')).toBe(false);

    const sql = renderMigrationSql(plan);
    expect(sql).toContain('ALTER TABLE "User" RENAME TO "Account";');
    expect(sql).toContain('ALTER TABLE "Post" RENAME COLUMN "title" TO "headline";');
  });
});
