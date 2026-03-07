import { buildSchemaGraph, loadSchemaProject, validateSchemaProject } from '@oxe/schema-core';

const run = async (): Promise<void> => {
  const project = await loadSchemaProject({
    rootDir: new URL('..', import.meta.url).pathname,
    schemaRoots: ['schemas'],
  });

  const validation = validateSchemaProject(project);

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
