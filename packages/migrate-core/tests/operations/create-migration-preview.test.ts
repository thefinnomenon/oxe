import { describe, expect, it } from 'vitest';

import { createMigrationPreview, type MigrationPlan } from '../../src/index.js';

describe('createMigrationPreview', () => {
  it('summarizes plan operations and renders SQL preview', () => {
    const plan: MigrationPlan = {
      blocked: false,
      diagnostics: [],
      operations: [
        {
          kind: 'create_enum',
          enum: {
            name: 'Status',
            dbName: 'status',
            values: ['a'],
            sourcePath: '',
          },
        },
      ],
    };

    const preview = createMigrationPreview(plan);
    expect(preview.hasChanges).toBe(true);
    expect(preview.operationCount).toBe(1);
    expect(preview.operationsByKind).toEqual({ create_enum: 1 });
    expect(preview.sql).toContain('CREATE TYPE "status"');
  });

  it('supports disabling sql rendering in preview', () => {
    const plan: MigrationPlan = {
      blocked: false,
      diagnostics: [],
      operations: [],
    };

    const preview = createMigrationPreview(plan, { includeSql: false });
    expect(preview.sql).toBe('');
    expect(preview.hasChanges).toBe(false);
  });
});
