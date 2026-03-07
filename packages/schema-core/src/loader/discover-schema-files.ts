import fg from 'fast-glob';

export interface DiscoverSchemaFilesOptions {
  rootDir: string;
  schemaRoots: string[];
}

export const discoverSchemaFiles = async ({
  rootDir,
  schemaRoots,
}: DiscoverSchemaFilesOptions): Promise<string[]> => {
  const patterns = schemaRoots.map((schemaRoot) => `${schemaRoot.replace(/\\/g, '/')}/**/*.ts`);

  const matches = await fg(patterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/*.d.ts'],
  });

  return matches.sort();
};
