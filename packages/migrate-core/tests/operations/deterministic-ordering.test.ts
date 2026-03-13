import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  generateMigrationPlan,
  orderMigrationOperations,
  type MigrationOperation,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('deterministic migration planning', () => {
  it('produces identical plans for identical input', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-b'));
    const diff = diffDatabaseSnapshots(previous, next);

    const planA = generateMigrationPlan(diff, { allowDestructive: true });
    const planB = generateMigrationPlan(diff, { allowDestructive: true });

    expect(JSON.stringify(planA)).toBe(JSON.stringify(planB));
  });

  it('orders operations deterministically with dependency-aware precedence', () => {
    const operations: MigrationOperation[] = [
      {
        kind: 'drop_table',
        table: {
          name: 'A',
          dbName: 'a',
          sourcePath: '',
          columns: {},
          primaryKey: undefined,
          indexes: {},
          uniqueConstraints: {},
          foreignKeys: {},
        },
      },
      {
        kind: 'drop_foreign_key',
        tableName: 'A',
        tableDbName: 'a',
        foreignKey: {
          name: 'a_ref_fkey',
          columns: ['refId'],
          referencedTable: 'b',
          referencedColumns: ['id'],
        },
      },
      {
        kind: 'create_enum',
        enum: {
          name: 'Status',
          dbName: 'status',
          values: ['a'],
          sourcePath: '',
        },
      },
      {
        kind: 'create_table',
        table: {
          name: 'B',
          dbName: 'b',
          sourcePath: '',
          columns: {
            id: {
              name: 'id',
              postgresType: 'uuid',
              isArray: false,
              nullable: false,
              isPrimaryKey: true,
              declaration: 'B',
              sourcePath: '',
              builtIn: true,
            },
          },
          primaryKey: { name: 'b_pkey', columns: ['id'] },
          indexes: {},
          uniqueConstraints: {},
          foreignKeys: {},
        },
      },
      {
        kind: 'add_foreign_key',
        tableName: 'A',
        tableDbName: 'a',
        foreignKey: {
          name: 'a_ref_fkey',
          columns: ['refId'],
          referencedTable: 'b',
          referencedColumns: ['id'],
        },
      },
    ];

    const orderedKinds = orderMigrationOperations(operations).map((operation) => operation.kind);
    expect(orderedKinds).toEqual([
      'create_enum',
      'create_table',
      'drop_foreign_key',
      'add_foreign_key',
      'drop_table',
    ]);
  });
});
