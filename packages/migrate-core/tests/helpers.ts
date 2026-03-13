import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSchemaGraph, loadSchemaProject } from '@oxe/schema-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const fixturesDir = path.join(__dirname, 'fixtures');
export const fixtureProjectsDir = path.join(fixturesDir, 'projects');

export const fixtureProjectPath = (projectName: string): string =>
  path.join(fixtureProjectsDir, projectName);

export const loadFixtureSchemaGraph = async (projectName: string) => {
  const project = await loadSchemaProject({
    rootDir: fixtureProjectPath(projectName),
    schemaRoots: ['schemas'],
  });

  return buildSchemaGraph(project);
};

export const getTestDatabaseUrl = (): string | undefined =>
  process.env.OXE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export const createTestSchemaName = (prefix = 'oxe_test'): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
