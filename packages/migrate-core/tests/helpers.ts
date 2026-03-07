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
