import { buildSchemaGraph, loadSchemaProject, validateSchemaProject } from '@oxe/schema-core';

const run = async (): Promise<void> => {
  const project = await loadSchemaProject({
    rootDir: new URL('..', import.meta.url).pathname,
    schemaRoots: ['schemas'],
  });

  const validation = validateSchemaProject(project);
  const warnings = validation.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');

  if (warnings.length > 0) {
    console.warn('Schema validation warnings:');
    for (const diagnostic of warnings) {
      console.warn(`- [${diagnostic.code}] ${diagnostic.message}`);
    }
  }

  if (!validation.ok) {
    console.error('Schema validation failed:');
    for (const diagnostic of validation.diagnostics) {
      console.error(`- [${diagnostic.code}] ${diagnostic.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const graph = buildSchemaGraph(project);
  console.log(JSON.stringify(graph, null, 2));
};

void run();
