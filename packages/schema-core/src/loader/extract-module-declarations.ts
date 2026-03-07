import { pathToFileURL } from 'node:url';

import { isSchemaDefinition } from '../dsl/brands.js';
import {
  isTopLevelDeclaration,
  type BucketDeclaration,
  type EnumDeclaration,
  type ObjectTypeDeclaration,
  type RoleDeclaration,
  type SchemaDefinition,
  type TableDeclaration,
} from '../dsl/declarations.js';
import type { LoadedSchemaModule } from './types.js';

interface DeclarationBuckets {
  roles: LoadedSchemaModule['roles'];
  enums: LoadedSchemaModule['enums'];
  types: LoadedSchemaModule['types'];
  tables: LoadedSchemaModule['tables'];
  buckets: LoadedSchemaModule['buckets'];
}

const emptyBuckets = (): DeclarationBuckets => ({
  roles: [],
  enums: [],
  types: [],
  tables: [],
  buckets: [],
});

const loadFromSchemaDefinition = (
  schema: SchemaDefinition,
  sourcePath: string,
): DeclarationBuckets => ({
  roles: schema.roles.map((declaration) => ({ declaration, sourcePath })),
  enums: schema.enums.map((declaration) => ({ declaration, sourcePath })),
  types: schema.types.map((declaration) => ({ declaration, sourcePath })),
  tables: schema.tables.map((declaration) => ({ declaration, sourcePath })),
  buckets: schema.buckets.map((declaration) => ({ declaration, sourcePath })),
});

const pushDeclaration = (
  buckets: DeclarationBuckets,
  declaration:
    | RoleDeclaration
    | EnumDeclaration
    | ObjectTypeDeclaration
    | TableDeclaration
    | BucketDeclaration,
  sourcePath: string,
  exportName: string,
): void => {
  if (declaration.declarationKind === 'role') {
    buckets.roles.push({ declaration, sourcePath, exportName });
    return;
  }

  if (declaration.declarationKind === 'enum') {
    buckets.enums.push({ declaration, sourcePath, exportName });
    return;
  }

  if (declaration.declarationKind === 'objectType') {
    buckets.types.push({ declaration, sourcePath, exportName });
    return;
  }

  if (declaration.declarationKind === 'table') {
    buckets.tables.push({ declaration, sourcePath, exportName });
    return;
  }

  buckets.buckets.push({ declaration, sourcePath, exportName });
};

export const extractModuleDeclarations = async (sourcePath: string): Promise<LoadedSchemaModule> => {
  const module = (await import(pathToFileURL(sourcePath).href)) as Record<string, unknown>;
  const defaultExport = module.default;

  if (isSchemaDefinition(defaultExport)) {
    const buckets = loadFromSchemaDefinition(defaultExport as SchemaDefinition, sourcePath);
    return {
      sourcePath,
      ...buckets,
    };
  }

  const buckets = emptyBuckets();

  for (const [exportName, value] of Object.entries(module)) {
    if (!isTopLevelDeclaration(value)) {
      continue;
    }

    pushDeclaration(buckets, value, sourcePath, exportName);
  }

  return {
    sourcePath,
    ...buckets,
  };
};
