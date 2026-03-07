import path from 'node:path';

import { discoverSchemaFiles } from './discover-schema-files.js';
import { extractModuleDeclarations } from './extract-module-declarations.js';
import type { LoadedSchemaProject, LoadSchemaProjectOptions } from './types.js';

export const loadSchemaProject = async (
  options: LoadSchemaProjectOptions = {},
): Promise<LoadedSchemaProject> => {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  const schemaRoots = options.schemaRoots ?? ['schemas'];

  const schemaFiles = await discoverSchemaFiles({
    rootDir,
    schemaRoots,
  });

  const modules = await Promise.all(schemaFiles.map((sourcePath) => extractModuleDeclarations(sourcePath)));

  return {
    rootDir,
    schemaRoots,
    schemaFiles,
    modules,
    declarations: {
      roles: modules.flatMap((module) => module.roles),
      enums: modules.flatMap((module) => module.enums),
      types: modules.flatMap((module) => module.types),
      tables: modules.flatMap((module) => module.tables),
      buckets: modules.flatMap((module) => module.buckets),
    },
  };
};
