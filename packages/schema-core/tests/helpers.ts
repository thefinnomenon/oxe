import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSchemaProject, type LoadedSchemaProject } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const fixturesProjectsDir = path.join(__dirname, 'fixtures', 'projects');

export const fixtureProjectPath = (projectName: string): string =>
  path.join(fixturesProjectsDir, projectName);

export const loadFixtureProject = async (projectName: string): Promise<LoadedSchemaProject> =>
  loadSchemaProject({
    rootDir: fixtureProjectPath(projectName),
    schemaRoots: ['schemas'],
  });
