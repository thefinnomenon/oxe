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
    expect(sqlA).toContain('CREATE TABLE "Post"');
    expect(sqlA).toContain('ALTER TABLE "Post" ADD CONSTRAINT "post_author_id_fkey"');
    expect(sqlA).toContain('COMMIT;');

    expect(sqlA.indexOf('CREATE TYPE "enum_post_status"')).toBeLessThan(
      sqlA.indexOf('CREATE TABLE "Post"'),
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
    expect(sql).toContain('ALTER TABLE "Post" DROP COLUMN "body";');
    expect(sql).toContain('ALTER TABLE "Post" ALTER COLUMN "status" SET DEFAULT');
  });
});
