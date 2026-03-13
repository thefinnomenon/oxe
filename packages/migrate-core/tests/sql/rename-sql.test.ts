import { describe, expect, it } from 'vitest';

import { renderMigrationSql, type MigrationPlan } from '../../src/index.js';

describe('rename SQL rendering', () => {
  it('renders rename table and rename column statements', () => {
    const plan: MigrationPlan = {
      blocked: false,
      diagnostics: [],
      operations: [
        {
          kind: 'rename_table',
          tableName: 'Account',
          fromDbName: 'User',
          toDbName: 'Account',
        },
        {
          kind: 'rename_column',
          tableName: 'Account',
          tableDbName: 'Account',
          fromColumnName: 'fullName',
          toColumnName: 'displayName',
        },
      ],
    };

    const sql = renderMigrationSql(plan);
    expect(sql).toContain('ALTER TABLE "User" RENAME TO "Account";');
    expect(sql).toContain('ALTER TABLE "Account" RENAME COLUMN "fullName" TO "displayName";');
  });
});
