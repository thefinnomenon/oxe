import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  generateMigrationPlan,
  renderMigrationSql,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('renderMigrationSql', () => {
  it('renders deterministic SQL for init migration', async () => {
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-a'));
    const diff = diffDatabaseSnapshots(null, next);
    const plan = generateMigrationPlan(diff, { allowDestructive: true });

    const sqlA = renderMigrationSql(plan);
    const sqlB = renderMigrationSql(plan);

    expect(sqlA).toBe(sqlB);
    expect(sqlA).toContain('BEGIN;');
    expect(sqlA).toContain('CREATE TYPE "enum_post_status" AS ENUM');
    expect(sqlA).toContain('CREATE TABLE "app_posts"');
    expect(sqlA).toContain('ALTER TABLE "app_posts" ADD CONSTRAINT "app_posts_author_id_fkey"');
    expect(sqlA).toContain('COMMIT;');

    expect(sqlA.indexOf('CREATE TYPE "enum_post_status"')).toBeLessThan(
      sqlA.indexOf('CREATE TABLE "app_posts"'),
    );
  });

  it('renders alter/drop SQL for evolving migration', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-b'));

    const plan = generateMigrationPlan(diffDatabaseSnapshots(previous, next), {
      allowDestructive: true,
    });
    const sql = renderMigrationSql(plan, { abortOnBlockedPlan: false });

    expect(sql).toContain('ALTER TYPE "enum_post_status" ADD VALUE IF NOT EXISTS');
    expect(sql).toContain('ALTER TABLE "app_posts" DROP COLUMN "body";');
    expect(sql).toContain('ALTER TABLE "app_posts" ALTER COLUMN "status" SET DEFAULT');
  });

  it('enforces dependency-safe SQL ordering regardless of input operation order', () => {
    const sql = renderMigrationSql({
      blocked: false,
      diagnostics: [],
      operations: [
        {
          kind: 'drop_table',
          table: {
            name: 'User',
            dbName: 'user_table',
            sourcePath: '',
            columns: {},
            primaryKey: undefined,
            indexes: {},
            uniqueConstraints: {},
            foreignKeys: {},
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
            name: 'Post',
            dbName: 'post_table',
            sourcePath: '',
            columns: {
              id: {
                name: 'id',
                postgresType: 'uuid',
                isArray: false,
                nullable: false,
                isPrimaryKey: true,
                declaration: 'Post',
                sourcePath: '',
                builtIn: true,
              },
            },
            primaryKey: {
              name: 'post_table_pkey',
              columns: ['id'],
            },
            indexes: {},
            uniqueConstraints: {},
            foreignKeys: {},
          },
        },
      ],
    });

    expect(sql.indexOf('CREATE TYPE "status"')).toBeLessThan(
      sql.indexOf('CREATE TABLE "post_table"'),
    );
    expect(sql.indexOf('CREATE TABLE "post_table"')).toBeLessThan(
      sql.indexOf('DROP TABLE "user_table"'),
    );
  });
});
