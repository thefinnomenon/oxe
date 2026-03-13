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

export const getTestMinioConfig = (): {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
} | null => {
  const endpoint = process.env.OXE_TEST_MINIO_ENDPOINT;
  const accessKeyId = process.env.OXE_TEST_MINIO_ACCESS_KEY;
  const secretAccessKey = process.env.OXE_TEST_MINIO_SECRET_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    endpoint,
    region: process.env.OXE_TEST_MINIO_REGION ?? 'us-east-1',
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true,
  };
};

export const getTestDatabaseUrl = (): string | undefined =>
  process.env.OXE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
