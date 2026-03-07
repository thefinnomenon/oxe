import { describe, expect, it } from 'vitest';

import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  generateMigrationPlan,
} from '../../src/index.js';
import { loadFixtureSchemaGraph } from '../helpers.js';

describe('generateMigrationPlan destructive behavior', () => {
  it('blocks by default on destructive/risky changes', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-b'));

    const diff = diffDatabaseSnapshots(previous, next);
    const plan = generateMigrationPlan(diff);

    expect(plan.blocked).toBe(true);
    expect(
      plan.diagnostics.some((diagnostic) => diagnostic.code === 'DESTRUCTIVE_DROP_COLUMN'),
    ).toBe(true);
    expect(
      plan.diagnostics.some((diagnostic) => diagnostic.code === 'RISKY_ALTER_COLUMN_TYPE'),
    ).toBe(false);
    expect(
      plan.diagnostics.some(
        (diagnostic) => diagnostic.code === 'PLAN_BLOCKED_REQUIRES_ALLOW_DESTRUCTIVE',
      ),
    ).toBe(true);
  });

  it('allows plan when explicitly enabled', async () => {
    const previous = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-a'));
    const next = buildDatabaseSnapshot(await loadFixtureSchemaGraph('e2e-b'));

    const plan = generateMigrationPlan(diffDatabaseSnapshots(previous, next), {
      allowDestructive: true,
    });

    expect(plan.blocked).toBe(false);
    expect(plan.operations.length).toBeGreaterThan(0);
  });
});
