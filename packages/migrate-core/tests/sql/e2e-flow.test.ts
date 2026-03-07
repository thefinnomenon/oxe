import { cp, mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { buildSchemaGraph, loadSchemaProject } from '@oxe/schema-core';

import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  generateMigrationPlan,
  loadDatabaseSnapshot,
  renderMigrationSql,
  writeMigrationFiles,
} from '../../src/index.js';
import { fixtureProjectPath } from '../helpers.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
  tempDirs.length = 0;
});

const setupTempProject = async (): Promise<string> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oxe-migrate-test-'));

  tempDirs.push(tempRoot);

  await mkdir(path.join(tempRoot, 'schemas'), { recursive: true });

  return tempRoot;
};

describe('migration e2e flow', () => {
  it('writes migration sql files and snapshot across sequential generations', async () => {
    const rootDir = await setupTempProject();
    const secondRootDir = await setupTempProject();

    const loadGraphFromRoot = async (targetRootDir: string) => {
      const project = await loadSchemaProject({ rootDir: targetRootDir, schemaRoots: ['schemas'] });
      return buildSchemaGraph(project);
    };

    const firstFixture = fixtureProjectPath('e2e-a');
    await cp(path.join(firstFixture, 'schemas'), path.join(rootDir, 'schemas'), {
      recursive: true,
    });

    const firstGraph = await loadGraphFromRoot(rootDir);
    const firstSnapshot = buildDatabaseSnapshot(firstGraph);

    const firstPlan = generateMigrationPlan(diffDatabaseSnapshots(null, firstSnapshot), {
      allowDestructive: true,
    });

    const firstSql = renderMigrationSql(firstPlan);

    const firstWrite = await writeMigrationFiles({
      plan: firstPlan,
      nextSnapshot: firstSnapshot,
      sql: firstSql,
      options: {
        rootDir,
        migrationName: 'init',
      },
    });

    expect(firstWrite.wroteMigration).toBe(true);
    expect(firstWrite.migrationPath).toBeDefined();
    expect(firstWrite.migrationPath).toContain('0001_init.sql');

    const secondFixture = fixtureProjectPath('e2e-b');
    await cp(path.join(secondFixture, 'schemas'), path.join(secondRootDir, 'schemas'), {
      recursive: true,
    });

    const previousSnapshot = await loadDatabaseSnapshot({ rootDir });
    const secondGraph = await loadGraphFromRoot(secondRootDir);
    const secondSnapshot = buildDatabaseSnapshot(secondGraph);

    const secondPlan = generateMigrationPlan(
      diffDatabaseSnapshots(previousSnapshot, secondSnapshot),
      {
        allowDestructive: true,
      },
    );

    const secondWrite = await writeMigrationFiles({
      plan: secondPlan,
      nextSnapshot: secondSnapshot,
      sql: renderMigrationSql(secondPlan, { abortOnBlockedPlan: false }),
      options: {
        rootDir,
        migrationName: 'evolve',
      },
    });

    expect(secondWrite.wroteMigration).toBe(true);
    expect(secondWrite.migrationPath).toBeDefined();
    expect(secondWrite.migrationPath).toContain('0002_evolve.sql');

    const migrationFiles = await readdir(path.join(rootDir, 'migrations'));
    expect(migrationFiles.sort()).toEqual(['0001_init.sql', '0002_evolve.sql']);

    const savedSnapshot = await readFile(path.join(rootDir, '.oxe', 'db-snapshot.json'), 'utf8');
    expect(savedSnapshot).toContain('"Comment"');
  });
});
