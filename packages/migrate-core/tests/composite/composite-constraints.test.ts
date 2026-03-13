import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  generateMigrationPlan,
  renderMigrationSql,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('composite indexes and uniques', () => {
  it('maps table-level composite constraints into snapshot metadata', async () => {
    const snapshot = buildDatabaseSnapshot(await loadFixtureSchemaGraph('composite-a'));
    const membership = snapshot.tables.Membership;

    expect(Object.keys(membership.indexes)).toContain('membership_org_id_created_at_idx');
    expect(Object.keys(membership.uniqueConstraints)).toContain('membership_org_id_user_id_key');
    expect(membership.indexes.membership_org_id_created_at_idx.columns).toEqual([
      'orgId',
      'createdAt',
    ]);
    expect(membership.uniqueConstraints.membership_org_id_user_id_key.columns).toEqual([
      'orgId',
      'userId',
    ]);
  });

  it('detects composite index/unique add/remove and renders SQL', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('composite-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('composite-b'));
    const diff = diffDatabaseSnapshots(previous, next);
    const plan = generateMigrationPlan(diff, { allowDestructive: true });
    const sql = renderMigrationSql(plan);

    expect(
      diff.changes.indexesRemoved.map((change) => `${change.tableName}.${change.indexName}`),
    ).toContain('Membership.membership_org_id_created_at_idx');
    expect(
      diff.changes.indexesAdded.map((change) => `${change.tableName}.${change.indexName}`),
    ).toContain('Membership.membership_org_id_user_id_idx');
    expect(
      diff.changes.uniquesRemoved.map((change) => `${change.tableName}.${change.uniqueName}`),
    ).toContain('Membership.membership_org_id_user_id_key');
    expect(
      diff.changes.uniquesAdded.map((change) => `${change.tableName}.${change.uniqueName}`),
    ).toContain('Membership.membership_org_id_role_key');

    expect(sql).toContain('DROP INDEX "membership_org_id_created_at_idx";');
    expect(sql).toContain(
      'ALTER TABLE "Membership" ADD CONSTRAINT "membership_org_id_role_key" UNIQUE ("orgId", "role");',
    );
  });
});
