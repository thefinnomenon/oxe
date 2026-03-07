import { createDiagnostic, type Diagnostic } from '../diagnostics/index.js';
import { BUILT_IN_TABLE_FIELD_NAMES } from '../dsl/constants.js';
import type {
  BucketDeclaration,
  EnumDeclaration,
  ObjectTypeDeclaration,
  TableDeclaration,
  TopLevelDeclaration,
} from '../dsl/declarations.js';
import type { FieldDbMetadata, FieldDefinition } from '../dsl/field-types.js';
import type { LoadedDeclaration, LoadedSchemaProject } from '../loader/types.js';
import type { SchemaValidationResult } from './types.js';

const bucketMetadataKeys = new Set<keyof BucketDeclaration['metadata']>([
  'mediaType',
  'fileTypes',
  'size',
  'duration',
  'dimensions',
  'ttlSeconds',
]);

const hasDbDirectives = (db: FieldDbMetadata): boolean =>
  db.primary ||
  db.defaultValue !== undefined ||
  db.unique ||
  db.index ||
  db.references !== undefined ||
  db.onDelete !== undefined ||
  db.autoUpdated;

const validateCaseInsensitiveFieldNames = (
  fields: Record<string, FieldDefinition>,
  declaration: LoadedDeclaration<TopLevelDeclaration | ObjectTypeDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  const seenByLowerName = new Map<string, string>();

  for (const fieldName of Object.keys(fields)) {
    const normalized = fieldName.toLowerCase();
    const firstName = seenByLowerName.get(normalized);

    if (firstName && firstName !== fieldName) {
      diagnostics.push(
        createDiagnostic({
          code: 'DUPLICATE_FIELD_NAME',
          message: `Duplicate field names differ only by case: "${firstName}" and "${fieldName}".`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
      continue;
    }

    seenByLowerName.set(normalized, fieldName);
  }
};

const validateOwnerCardinality = (
  fields: Record<string, FieldDefinition>,
  declaration: LoadedDeclaration<TableDeclaration | BucketDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  const owners = Object.entries(fields).filter(([, fieldDefinition]) => fieldDefinition.owner);

  if (owners.length <= 1) {
    return;
  }

  diagnostics.push(
    createDiagnostic({
      code: 'MULTIPLE_OWNER_FIELDS',
      message: `Only one owner field is allowed for ${declaration.declaration.declarationKind} "${declaration.declaration.name}". Found ${owners.length}.`,
      source: {
        file: declaration.sourcePath,
        declaration: declaration.declaration.name,
      },
    }),
  );
};

const validateObjectTypeFieldRules = (
  declaration: LoadedDeclaration<ObjectTypeDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  for (const [fieldName, fieldDefinition] of Object.entries(declaration.declaration.fields)) {
    if (fieldDefinition.auth) {
      diagnostics.push(
        createDiagnostic({
          code: 'OBJECT_TYPE_AUTH_NOT_ALLOWED',
          message: `Object type fields cannot include auth metadata.`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
    }

    if (fieldDefinition.owner) {
      diagnostics.push(
        createDiagnostic({
          code: 'OBJECT_TYPE_OWNER_NOT_ALLOWED',
          message: `Object type fields cannot include owner metadata.`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
    }

    if (hasDbDirectives(fieldDefinition.db)) {
      diagnostics.push(
        createDiagnostic({
          code: 'OBJECT_TYPE_DB_METADATA_NOT_ALLOWED',
          message: `Object type fields cannot include DB directives (primary/default/unique/index/references/onDelete).`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
    }
  }
};

const validateOnDeleteRequiresReferences = (
  declaration: LoadedDeclaration<TableDeclaration | BucketDeclaration | ObjectTypeDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  for (const [fieldName, fieldDefinition] of Object.entries(declaration.declaration.fields)) {
    if (fieldDefinition.db.onDelete && !fieldDefinition.db.references) {
      diagnostics.push(
        createDiagnostic({
          code: 'ON_DELETE_WITHOUT_REFERENCES',
          message: `Field "${fieldName}" uses onDelete without references().`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
    }
  }
};

const validateUnknownTypeReferences = (
  declaration: LoadedDeclaration<TableDeclaration | BucketDeclaration | ObjectTypeDeclaration>,
  knownEnumNames: Set<string>,
  knownObjectTypeNames: Set<string>,
  knownTableNames: Set<string>,
  diagnostics: Diagnostic[],
): void => {
  for (const [fieldName, fieldDefinition] of Object.entries(declaration.declaration.fields)) {
    if (fieldDefinition.type.kind === 'enum' && !knownEnumNames.has(fieldDefinition.type.enumName)) {
      diagnostics.push(
        createDiagnostic({
          code: 'UNKNOWN_ENUM_REFERENCE',
          message: `Field "${fieldName}" references unknown enum "${fieldDefinition.type.enumName}".`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
    }

    if (
      fieldDefinition.type.kind === 'object' &&
      !knownObjectTypeNames.has(fieldDefinition.type.objectTypeName)
    ) {
      diagnostics.push(
        createDiagnostic({
          code: 'UNKNOWN_OBJECT_TYPE_REFERENCE',
          message: `Field "${fieldName}" references unknown object type "${fieldDefinition.type.objectTypeName}".`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
    }

    if (fieldDefinition.db.references && !knownTableNames.has(fieldDefinition.db.references)) {
      diagnostics.push(
        createDiagnostic({
          code: 'UNKNOWN_TABLE_REFERENCE',
          message: `Field "${fieldName}" references unknown table "${fieldDefinition.db.references}".`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
    }
  }
};

const validateEnumMembers = (
  declaration: LoadedDeclaration<EnumDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  const seen = new Set<string>();

  for (const member of declaration.declaration.members) {
    if (seen.has(member)) {
      diagnostics.push(
        createDiagnostic({
          code: 'DUPLICATE_ENUM_MEMBER',
          message: `Enum "${declaration.declaration.name}" has duplicate member "${member}".`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
          },
        }),
      );
      continue;
    }

    seen.add(member);
  }
};

const validateBuiltInFieldConflicts = (
  declaration: LoadedDeclaration<TableDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  for (const fieldName of Object.keys(declaration.declaration.fields)) {
    if (!BUILT_IN_TABLE_FIELD_NAMES.includes(fieldName as (typeof BUILT_IN_TABLE_FIELD_NAMES)[number])) {
      continue;
    }

    diagnostics.push(
      createDiagnostic({
        code: 'BUILT_IN_FIELD_OVERRIDE',
        message: `Table "${declaration.declaration.name}" cannot override built-in field "${fieldName}".`,
        source: {
          file: declaration.sourcePath,
          declaration: declaration.declaration.name,
          field: fieldName,
        },
      }),
    );
  }
};

const validateDuplicateDeclarationNames = (project: LoadedSchemaProject, diagnostics: Diagnostic[]): void => {
  type NamedLoadedDeclaration =
    | LoadedDeclaration<TableDeclaration>
    | LoadedDeclaration<BucketDeclaration>
    | LoadedDeclaration<ObjectTypeDeclaration>
    | LoadedDeclaration<EnumDeclaration>
    | LoadedDeclaration<{ declarationKind: 'role'; name: string }>;

  const allDeclarations: NamedLoadedDeclaration[] = [
    ...project.declarations.roles,
    ...project.declarations.enums,
    ...project.declarations.types,
    ...project.declarations.tables,
    ...project.declarations.buckets,
  ];

  const byName = new Map<string, NamedLoadedDeclaration[]>();

  for (const declaration of allDeclarations) {
    const bucket = byName.get(declaration.declaration.name) ?? [];
    bucket.push(declaration);
    byName.set(declaration.declaration.name, bucket);
  }

  for (const [name, declarations] of byName.entries()) {
    if (declarations.length <= 1) {
      continue;
    }

    const kinds = declarations
      .map((entry) => `${entry.declaration.declarationKind} @ ${entry.sourcePath}`)
      .join(', ');

    for (const declaration of declarations) {
      diagnostics.push(
        createDiagnostic({
          code: 'DUPLICATE_DECLARATION_NAME',
          message: `Duplicate declaration name "${name}" detected across project (${kinds}).`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
          },
        }),
      );
    }
  }
};

const validateBucketMetadataOnNonBucketDeclarations = (
  declarations: Array<LoadedDeclaration<TableDeclaration | ObjectTypeDeclaration>>,
  diagnostics: Diagnostic[],
): void => {
  for (const declaration of declarations) {
    const maybeMetadata = (declaration.declaration as unknown as { metadata?: unknown }).metadata;

    if (!maybeMetadata || typeof maybeMetadata !== 'object') {
      continue;
    }

    const invalidKeys = Object.keys(maybeMetadata).filter((key) =>
      bucketMetadataKeys.has(key as keyof BucketDeclaration['metadata']),
    );

    if (invalidKeys.length === 0) {
      continue;
    }

    diagnostics.push(
      createDiagnostic({
        code: 'BUCKET_METADATA_ON_NON_BUCKET',
        message: `Bucket-only metadata keys (${invalidKeys.join(', ')}) are not valid on ${declaration.declaration.declarationKind} declarations.`,
        source: {
          file: declaration.sourcePath,
          declaration: declaration.declaration.name,
        },
      }),
    );
  }
};

export const validateSchemaProject = (project: LoadedSchemaProject): SchemaValidationResult => {
  const diagnostics: Diagnostic[] = [];

  validateDuplicateDeclarationNames(project, diagnostics);
  for (const enumDeclaration of project.declarations.enums) {
    validateEnumMembers(enumDeclaration, diagnostics);
  }

  validateBucketMetadataOnNonBucketDeclarations(
    [...project.declarations.tables, ...project.declarations.types],
    diagnostics,
  );

  const knownTableNames = new Set(project.declarations.tables.map((entry) => entry.declaration.name));
  const knownEnumNames = new Set(project.declarations.enums.map((entry) => entry.declaration.name));
  const knownObjectTypeNames = new Set(project.declarations.types.map((entry) => entry.declaration.name));

  for (const tableDeclaration of project.declarations.tables) {
    validateCaseInsensitiveFieldNames(tableDeclaration.declaration.fields, tableDeclaration, diagnostics);
    validateOwnerCardinality(tableDeclaration.declaration.fields, tableDeclaration, diagnostics);
    validateOnDeleteRequiresReferences(tableDeclaration, diagnostics);
    validateUnknownTypeReferences(
      tableDeclaration,
      knownEnumNames,
      knownObjectTypeNames,
      knownTableNames,
      diagnostics,
    );
    validateBuiltInFieldConflicts(tableDeclaration, diagnostics);
  }

  for (const bucketDeclaration of project.declarations.buckets) {
    validateCaseInsensitiveFieldNames(bucketDeclaration.declaration.fields, bucketDeclaration, diagnostics);
    validateOwnerCardinality(bucketDeclaration.declaration.fields, bucketDeclaration, diagnostics);
    validateOnDeleteRequiresReferences(bucketDeclaration, diagnostics);
    validateUnknownTypeReferences(
      bucketDeclaration,
      knownEnumNames,
      knownObjectTypeNames,
      knownTableNames,
      diagnostics,
    );
  }

  for (const objectTypeDeclaration of project.declarations.types) {
    validateCaseInsensitiveFieldNames(objectTypeDeclaration.declaration.fields, objectTypeDeclaration, diagnostics);
    validateObjectTypeFieldRules(objectTypeDeclaration, diagnostics);
    validateOnDeleteRequiresReferences(objectTypeDeclaration, diagnostics);
    validateUnknownTypeReferences(
      objectTypeDeclaration,
      knownEnumNames,
      knownObjectTypeNames,
      knownTableNames,
      diagnostics,
    );
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
  };
};
