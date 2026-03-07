import type {
  BucketDeclaration,
  EnumDeclaration,
  ObjectTypeDeclaration,
  RoleDeclaration,
  TableDeclaration,
} from '../dsl/declarations.js';

export interface LoadedDeclaration<TDeclaration> {
  declaration: TDeclaration;
  sourcePath: string;
  exportName?: string;
}

export interface LoadedSchemaModule {
  sourcePath: string;
  roles: LoadedDeclaration<RoleDeclaration>[];
  enums: LoadedDeclaration<EnumDeclaration>[];
  types: LoadedDeclaration<ObjectTypeDeclaration>[];
  tables: LoadedDeclaration<TableDeclaration>[];
  buckets: LoadedDeclaration<BucketDeclaration>[];
}

export interface LoadedSchemaProject {
  rootDir: string;
  schemaRoots: string[];
  schemaFiles: string[];
  modules: LoadedSchemaModule[];
  declarations: {
    roles: LoadedDeclaration<RoleDeclaration>[];
    enums: LoadedDeclaration<EnumDeclaration>[];
    types: LoadedDeclaration<ObjectTypeDeclaration>[];
    tables: LoadedDeclaration<TableDeclaration>[];
    buckets: LoadedDeclaration<BucketDeclaration>[];
  };
}

export interface LoadSchemaProjectOptions {
  rootDir?: string;
  schemaRoots?: string[];
}
