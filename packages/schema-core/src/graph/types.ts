import type { Diagnostic } from '../diagnostics/types.js';
import type { AuthAction } from '../dsl/auth.js';
import type { CrudAction } from '../dsl/crud.js';
import type {
  BucketDimensions,
  EnumDeclaration,
  ObjectTypeDeclaration,
  RoleDeclaration,
  TableMetadata,
} from '../dsl/declarations.js';
import type {
  FieldDbMetadata,
  FieldTransform,
  FieldTypeRef,
  FieldValidator,
  OnDeleteBehavior,
} from '../dsl/field-types.js';

export type NormalizedAuth = Record<AuthAction, string[]>;

export interface NormalizedCrud {
  enabled: boolean;
  actions: CrudAction[];
}

export interface FieldProvenance {
  sourcePath: string;
  declaration: string;
  builtIn: boolean;
}

export interface NormalizedRelationshipMetadata {
  targetTable: string;
  onDelete?: OnDeleteBehavior;
}

export interface NormalizedField {
  name: string;
  type: FieldTypeRef;
  optional: boolean;
  array: boolean;
  transforms: FieldTransform[];
  validators: FieldValidator[];
  db: FieldDbMetadata;
  relationship?: NormalizedRelationshipMetadata;
  ownership?: {
    isOwner: true;
  };
  auth: NormalizedAuth;
  provenance: FieldProvenance;
}

export interface NormalizedEnum {
  name: EnumDeclaration['name'];
  members: EnumDeclaration['members'];
  sourcePath: string;
}

export interface NormalizedObjectType {
  name: ObjectTypeDeclaration['name'];
  fields: Record<string, NormalizedField>;
  sourcePath: string;
}

export interface NormalizedRole {
  name: RoleDeclaration['name'];
  sourcePath: string;
}

export interface NormalizedTable {
  name: string;
  fields: Record<string, NormalizedField>;
  auth: NormalizedAuth;
  crud: NormalizedCrud;
  ownerField?: string;
  metadata: TableMetadata;
  sourcePath: string;
}

export interface NormalizedBucketMetadata {
  mimeType: string[];
  size: {
    min?: number;
    max?: number;
  };
  duration: {
    min?: number;
    max?: number;
  };
  dimensions: {
    min?: BucketDimensions;
    max?: BucketDimensions;
  };
  ttlSeconds?: number;
}

export interface NormalizedBucket {
  name: string;
  fields: Record<string, NormalizedField>;
  auth: NormalizedAuth;
  crud: NormalizedCrud;
  ownerField?: string;
  metadata: NormalizedBucketMetadata;
  sourcePath: string;
}

export interface SchemaGraphProvenance {
  roles: Record<string, string>;
  enums: Record<string, string>;
  types: Record<string, string>;
  tables: Record<string, string>;
  buckets: Record<string, string>;
}

export interface SchemaGraph {
  rootDir: string;
  declarations: {
    roles: string[];
    enums: string[];
    types: string[];
    tables: string[];
    buckets: string[];
  };
  provenance: SchemaGraphProvenance;
  roles: Record<string, NormalizedRole>;
  enums: Record<string, NormalizedEnum>;
  objectTypes: Record<string, NormalizedObjectType>;
  tables: Record<string, NormalizedTable>;
  buckets: Record<string, NormalizedBucket>;
  diagnostics: Diagnostic[];
}
