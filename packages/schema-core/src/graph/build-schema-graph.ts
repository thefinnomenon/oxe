import { BUILT_IN_TABLE_FIELD_NAMES } from '../dsl/constants.js';
import type {
  BucketDeclaration,
  BucketMetadata,
  EnumDeclaration,
  ObjectTypeDeclaration,
  RoleDeclaration,
  TableDeclaration,
} from '../dsl/declarations.js';
import { cloneFieldDefinition, type FieldDefinition } from '../dsl/field-types.js';
import type { LoadedDeclaration, LoadedSchemaProject } from '../loader/types.js';
import { validateSchemaProject } from '../semantics/validate-schema-project.js';
import { createBuiltInTableFields } from './built-ins.js';
import { normalizeAuth } from './normalize-auth.js';
import type {
  NormalizedBucket,
  NormalizedBucketMetadata,
  NormalizedEnum,
  NormalizedField,
  NormalizedObjectType,
  NormalizedRole,
  NormalizedTable,
  SchemaGraph,
} from './types.js';

const normalizeField = (
  fieldName: string,
  field: FieldDefinition,
  sourcePath: string,
  declarationName: string,
  builtIn: boolean,
): NormalizedField => {
  const db = { ...field.db };

  return {
    name: fieldName,
    type: { ...field.type },
    optional: field.optional,
    array: field.array,
    transforms: [...field.transforms],
    validators: [...field.validators],
    db,
    relationship: db.references
      ? {
          targetTable: db.references,
          onDelete: db.onDelete,
        }
      : undefined,
    ownership: field.owner ? { isOwner: true } : undefined,
    auth: normalizeAuth(field.auth),
    provenance: {
      sourcePath,
      declaration: declarationName,
      builtIn,
    },
  };
};

const normalizeBucketMetadata = (metadata: BucketMetadata): NormalizedBucketMetadata => ({
  mediaType: metadata.mediaType,
  fileTypes: [...(metadata.fileTypes ?? [])],
  size: {
    min: metadata.size?.min,
    max: metadata.size?.max,
  },
  duration: {
    min: metadata.duration?.min,
    max: metadata.duration?.max,
  },
  dimensions: {
    min: metadata.dimensions?.min,
    max: metadata.dimensions?.max,
  },
  ttlSeconds: metadata.ttlSeconds,
});

const normalizeRole = (entry: LoadedDeclaration<RoleDeclaration>): NormalizedRole => ({
  name: entry.declaration.name,
  sourcePath: entry.sourcePath,
});

const normalizeEnum = (entry: LoadedDeclaration<EnumDeclaration>): NormalizedEnum => ({
  name: entry.declaration.name,
  members: [...entry.declaration.members],
  sourcePath: entry.sourcePath,
});

const normalizeObjectType = (
  entry: LoadedDeclaration<ObjectTypeDeclaration>,
): NormalizedObjectType => {
  const fields = Object.fromEntries(
    Object.entries(entry.declaration.fields).map(([fieldName, fieldDefinition]) => [
      fieldName,
      normalizeField(
        fieldName,
        cloneFieldDefinition(fieldDefinition),
        entry.sourcePath,
        entry.declaration.name,
        false,
      ),
    ]),
  );

  return {
    name: entry.declaration.name,
    fields,
    sourcePath: entry.sourcePath,
  };
};

const normalizeTable = (entry: LoadedDeclaration<TableDeclaration>): NormalizedTable => {
  const builtIns = createBuiltInTableFields();

  const fields: Record<string, NormalizedField> = Object.fromEntries(
    Object.entries(builtIns).map(([fieldName, fieldDefinition]) => [
      fieldName,
      normalizeField(fieldName, fieldDefinition, '<built-in>', entry.declaration.name, true),
    ]),
  );

  for (const [fieldName, fieldDefinition] of Object.entries(entry.declaration.fields)) {
    if (BUILT_IN_TABLE_FIELD_NAMES.includes(fieldName as (typeof BUILT_IN_TABLE_FIELD_NAMES)[number])) {
      continue;
    }

    fields[fieldName] = normalizeField(
      fieldName,
      cloneFieldDefinition(fieldDefinition),
      entry.sourcePath,
      entry.declaration.name,
      false,
    );
  }

  const ownerField = Object.entries(fields).find(([, field]) => field.ownership?.isOwner)?.[0];

  return {
    name: entry.declaration.name,
    fields,
    auth: normalizeAuth(entry.declaration.auth),
    ownerField,
    sourcePath: entry.sourcePath,
  };
};

const normalizeBucket = (entry: LoadedDeclaration<BucketDeclaration>): NormalizedBucket => {
  const fields: Record<string, NormalizedField> = Object.fromEntries(
    Object.entries(entry.declaration.fields).map(([fieldName, fieldDefinition]) => [
      fieldName,
      normalizeField(
        fieldName,
        cloneFieldDefinition(fieldDefinition),
        entry.sourcePath,
        entry.declaration.name,
        false,
      ),
    ]),
  );

  const ownerField = Object.entries(fields).find(([, field]) => field.ownership?.isOwner)?.[0];

  return {
    name: entry.declaration.name,
    fields,
    auth: normalizeAuth(entry.declaration.auth),
    ownerField,
    metadata: normalizeBucketMetadata(entry.declaration.metadata),
    sourcePath: entry.sourcePath,
  };
};

export const buildSchemaGraph = (project: LoadedSchemaProject): SchemaGraph => {
  const validation = validateSchemaProject(project);

  const roles: Record<string, NormalizedRole> = {};
  const enums: Record<string, NormalizedEnum> = {};
  const objectTypes: Record<string, NormalizedObjectType> = {};
  const tables: Record<string, NormalizedTable> = {};
  const buckets: Record<string, NormalizedBucket> = {};

  const provenance = {
    roles: {} as Record<string, string>,
    enums: {} as Record<string, string>,
    types: {} as Record<string, string>,
    tables: {} as Record<string, string>,
    buckets: {} as Record<string, string>,
  };

  for (const entry of project.declarations.roles) {
    if (roles[entry.declaration.name]) {
      continue;
    }

    roles[entry.declaration.name] = normalizeRole(entry);
    provenance.roles[entry.declaration.name] = entry.sourcePath;
  }

  for (const entry of project.declarations.enums) {
    if (enums[entry.declaration.name]) {
      continue;
    }

    enums[entry.declaration.name] = normalizeEnum(entry);
    provenance.enums[entry.declaration.name] = entry.sourcePath;
  }

  for (const entry of project.declarations.types) {
    if (objectTypes[entry.declaration.name]) {
      continue;
    }

    objectTypes[entry.declaration.name] = normalizeObjectType(entry);
    provenance.types[entry.declaration.name] = entry.sourcePath;
  }

  for (const entry of project.declarations.tables) {
    if (tables[entry.declaration.name]) {
      continue;
    }

    tables[entry.declaration.name] = normalizeTable(entry);
    provenance.tables[entry.declaration.name] = entry.sourcePath;
  }

  for (const entry of project.declarations.buckets) {
    if (buckets[entry.declaration.name]) {
      continue;
    }

    buckets[entry.declaration.name] = normalizeBucket(entry);
    provenance.buckets[entry.declaration.name] = entry.sourcePath;
  }

  return {
    rootDir: project.rootDir,
    declarations: {
      roles: Object.keys(roles),
      enums: Object.keys(enums),
      types: Object.keys(objectTypes),
      tables: Object.keys(tables),
      buckets: Object.keys(buckets),
    },
    provenance,
    roles,
    enums,
    objectTypes,
    tables,
    buckets,
    diagnostics: validation.diagnostics,
  };
};
