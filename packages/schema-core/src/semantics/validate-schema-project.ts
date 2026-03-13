import { createDiagnostic, type Diagnostic } from '../diagnostics/index.js';
import {
  AUTH_ACTIONS,
  resolveAuthToken,
  type AuthAction,
  type AuthInput,
  type AuthToken,
  type AuthValue,
} from '../dsl/auth.js';
import { BUILT_IN_TABLE_FIELD_NAMES } from '../dsl/constants.js';
import { reduceMimeTypes } from '../dsl/mime-types.js';
import type {
  BucketDeclaration,
  CompositeConstraintDefinition,
  EnumDeclaration,
  ObjectTypeDeclaration,
  TableDeclaration,
  TopLevelDeclaration,
} from '../dsl/declarations.js';
import type { FieldDbMetadata, FieldDefinition, FieldValidator } from '../dsl/field-types.js';
import type { LoadedDeclaration, LoadedSchemaProject } from '../loader/types.js';
import type { SchemaValidationResult } from './types.js';

const bucketMetadataKeys = new Set<keyof BucketDeclaration['metadata']>([
  'mimeType',
  'duplicateMimeType',
  'duplicateMetadataKeys',
  'size',
  'duration',
  'dimensions',
  'ttlSeconds',
  'fileNamePolicy',
  'postUpload',
]);

const singleValueValidatorKinds = new Set<FieldValidator['kind']>([
  'minLength',
  'maxLength',
  'length',
  'email',
  'url',
  'uuid',
  'min',
  'max',
  'num',
]);

const hasDbDirectives = (db: FieldDbMetadata): boolean =>
  db.primary ||
  db.renameFrom !== undefined ||
  db.defaultValue !== undefined ||
  db.unique ||
  db.index ||
  db.references !== undefined ||
  db.onDelete !== undefined ||
  db.autoUpdated;

const toAuthTokens = (value: AuthValue | undefined): string[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((token) => resolveAuthToken(token));
  }

  return [resolveAuthToken(value as AuthToken)];
};

const collectAuthActionTokens = (auth: AuthInput | undefined): Record<AuthAction, string[]> => {
  const actionTokens: Record<AuthAction, string[]> = {
    get: [],
    getMany: [],
    create: [],
    update: [],
    delete: [],
  };

  if (!auth) {
    return actionTokens;
  }

  const readTokens = toAuthTokens(auth.read);
  actionTokens.get.push(...readTokens);
  actionTokens.getMany.push(...readTokens);

  const writeTokens = toAuthTokens(auth.write);
  actionTokens.create.push(...writeTokens);
  actionTokens.update.push(...writeTokens);

  for (const action of AUTH_ACTIONS) {
    actionTokens[action].push(...toAuthTokens(auth[action]));
  }

  return actionTokens;
};

const uniqueAuthActionTokens = (auth: AuthInput | undefined): Record<AuthAction, string[]> => {
  const tokens = collectAuthActionTokens(auth);

  return {
    get: [...new Set(tokens.get)],
    getMany: [...new Set(tokens.getMany)],
    create: [...new Set(tokens.create)],
    update: [...new Set(tokens.update)],
    delete: [...new Set(tokens.delete)],
  };
};

const sameTokenSet = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
};

const findDuplicateValues = (values: string[]): string[] => {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
};

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
  declaration: LoadedDeclaration<TableDeclaration>,
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
  declaration: LoadedDeclaration<TableDeclaration | ObjectTypeDeclaration>,
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

const validateAuthInputDuplicates = (
  auth: AuthInput | undefined,
  declaration: LoadedDeclaration<TableDeclaration | BucketDeclaration | ObjectTypeDeclaration>,
  diagnostics: Diagnostic[],
  fieldName?: string,
): void => {
  if (!auth) {
    return;
  }

  const actionTokens = collectAuthActionTokens(auth);

  for (const action of AUTH_ACTIONS) {
    const duplicates = findDuplicateValues(actionTokens[action]);

    if (duplicates.length === 0) {
      continue;
    }

    diagnostics.push(
      createDiagnostic({
        code: 'DUPLICATE_AUTH_SUBJECT',
        severity: 'warning',
        message: `Auth action "${action}" defines duplicate subjects (${duplicates.join(
          ', ',
        )}). Duplicates are ignored.`,
        source: {
          file: declaration.sourcePath,
          declaration: declaration.declaration.name,
          field: fieldName,
        },
      }),
    );
  }
};

const validateFieldAuthCoveredByResourceAuth = (
  declaration: LoadedDeclaration<TableDeclaration | ObjectTypeDeclaration>,
  fieldName: string,
  fieldAuth: AuthInput | undefined,
  diagnostics: Diagnostic[],
): void => {
  if (!fieldAuth) {
    return;
  }

  if (declaration.declaration.declarationKind !== 'table') {
    return;
  }

  const resourceTokens = uniqueAuthActionTokens(declaration.declaration.auth);
  const fieldTokens = uniqueAuthActionTokens(fieldAuth);

  const redundantActions: AuthAction[] = [];

  for (const action of AUTH_ACTIONS) {
    if (fieldTokens[action].length === 0 || resourceTokens[action].length === 0) {
      continue;
    }

    if (sameTokenSet(fieldTokens[action], resourceTokens[action])) {
      redundantActions.push(action);
    }
  }

  if (redundantActions.length === 0) {
    return;
  }

  diagnostics.push(
    createDiagnostic({
      code: 'REDUNDANT_FIELD_AUTH',
      severity: 'warning',
      message: `Field "${fieldName}" auth for action(s) ${redundantActions.join(
        ', ',
      )} is already covered by ${declaration.declaration.declarationKind} "${declaration.declaration.name}" auth.`,
      source: {
        file: declaration.sourcePath,
        declaration: declaration.declaration.name,
        field: fieldName,
      },
    }),
  );
};

const validateFieldAuthDoesNotLoosenResourceAuth = (
  declaration: LoadedDeclaration<TableDeclaration | ObjectTypeDeclaration>,
  fieldName: string,
  fieldAuth: AuthInput | undefined,
  diagnostics: Diagnostic[],
): void => {
  if (!fieldAuth) {
    return;
  }

  if (declaration.declaration.declarationKind !== 'table') {
    return;
  }

  const resourceTokens = uniqueAuthActionTokens(declaration.declaration.auth);
  const fieldTokens = uniqueAuthActionTokens(fieldAuth);

  for (const action of AUTH_ACTIONS) {
    const resourceActionTokens = resourceTokens[action];
    const fieldActionTokens = fieldTokens[action];

    if (resourceActionTokens.length === 0 || fieldActionTokens.length === 0) {
      continue;
    }

    const resourceSet = new Set(resourceActionTokens);
    const fieldSet = new Set(fieldActionTokens);

    const resourceHasPublic = resourceSet.has('public');
    const resourceHasPrivate = resourceSet.has('private');
    const fieldHasPublic = fieldSet.has('public');
    const fieldHasPrivate = fieldSet.has('private');

    const looseningSubjects = new Set<string>();

    // Public is always broader than non-public rules.
    if (!resourceHasPublic && fieldHasPublic) {
      looseningSubjects.add('public');
    }

    // "private" is broader than specific subject lists.
    if (!resourceHasPublic && !resourceHasPrivate && fieldHasPrivate) {
      looseningSubjects.add('private');
    }

    // For specific subject lists, field auth must remain a subset.
    if (!resourceHasPublic && !resourceHasPrivate && !fieldHasPublic && !fieldHasPrivate) {
      for (const token of fieldActionTokens) {
        if (!resourceSet.has(token)) {
          looseningSubjects.add(token);
        }
      }
    }

    if (looseningSubjects.size === 0) {
      continue;
    }

    diagnostics.push(
      createDiagnostic({
        code: 'FIELD_AUTH_LOOSENS_RESOURCE',
        message: `Field "${fieldName}" auth for action "${action}" loosens ${declaration.declaration.declarationKind} "${declaration.declaration.name}" auth by adding broader subjects (${[
          ...looseningSubjects,
        ].join(', ')}).`,
        source: {
          file: declaration.sourcePath,
          declaration: declaration.declaration.name,
          field: fieldName,
        },
      }),
    );
  }
};

const toValidatorSignature = (validator: FieldValidator): string => {
  switch (validator.kind) {
    case 'minLength':
      return `minLength:${validator.value}`;
    case 'maxLength':
      return `maxLength:${validator.value}`;
    case 'length':
      return `length:${validator.min}:${validator.max}`;
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    case 'uuid':
      return 'uuid';
    case 'regex':
      return `regex:${validator.source}/${validator.flags}`;
    case 'min':
      return `min:${validator.value}`;
    case 'max':
      return `max:${validator.value}`;
    case 'num':
      return `num:${validator.min}:${validator.max}`;
    case 'custom':
      return `custom:${validator.name}`;
  }
};

const validateFieldRenameFromUsage = (
  declaration: LoadedDeclaration<TableDeclaration | ObjectTypeDeclaration>,
  fieldName: string,
  fieldDefinition: FieldDefinition,
  diagnostics: Diagnostic[],
): void => {
  if (!fieldDefinition.db.renameFrom) {
    return;
  }

  if (declaration.declaration.declarationKind !== 'table') {
    diagnostics.push(
      createDiagnostic({
        code: 'COLUMN_RENAME_HINT_ON_NON_TABLE',
        message: `Field "${fieldName}" uses renameFrom(...) on ${declaration.declaration.declarationKind}. Column rename hints are only valid on table fields.`,
        source: {
          file: declaration.sourcePath,
          declaration: declaration.declaration.name,
          field: fieldName,
        },
      }),
    );
    return;
  }

  if (fieldDefinition.db.renameFrom === fieldName) {
    diagnostics.push(
      createDiagnostic({
        code: 'REDUNDANT_COLUMN_RENAME_HINT',
        severity: 'warning',
        message: `Field "${fieldName}" has renameFrom("${fieldName}") which is redundant and ignored.`,
        source: {
          file: declaration.sourcePath,
          declaration: declaration.declaration.name,
          field: fieldName,
        },
      }),
    );
  }
};

const validateFieldDuplicateDefinitions = (
  declaration: LoadedDeclaration<TableDeclaration | ObjectTypeDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  for (const [fieldName, fieldDefinition] of Object.entries(declaration.declaration.fields)) {
    validateFieldRenameFromUsage(declaration, fieldName, fieldDefinition, diagnostics);
    validateAuthInputDuplicates(fieldDefinition.auth, declaration, diagnostics, fieldName);

    if (declaration.declaration.declarationKind === 'table' && fieldDefinition.auth) {
      validateFieldAuthDoesNotLoosenResourceAuth(
        declaration,
        fieldName,
        fieldDefinition.auth,
        diagnostics,
      );
      validateFieldAuthCoveredByResourceAuth(
        declaration,
        fieldName,
        fieldDefinition.auth,
        diagnostics,
      );
    }

    const validatorKinds = fieldDefinition.validators.map((validator) => validator.kind);
    const duplicateValidatorKinds = findDuplicateValues(
      validatorKinds.filter((kind) => singleValueValidatorKinds.has(kind)),
    );

    const duplicateValidatorEntries = findDuplicateValues(
      fieldDefinition.validators.map((validator) => toValidatorSignature(validator)),
    );

    if (duplicateValidatorKinds.length > 0 || duplicateValidatorEntries.length > 0) {
      const parts: string[] = [];

      if (duplicateValidatorKinds.length > 0) {
        parts.push(`duplicate validator kinds: ${duplicateValidatorKinds.join(', ')}`);
      }

      if (duplicateValidatorEntries.length > 0) {
        parts.push(`duplicate validator entries: ${duplicateValidatorEntries.join(', ')}`);
      }

      diagnostics.push(
        createDiagnostic({
          code: 'DUPLICATE_FIELD_VALIDATOR',
          severity: 'warning',
          message: `Field "${fieldName}" has duplicate validators (${parts.join('; ')}). Duplicates are ignored.`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
    }

    const validatorKindSet = new Set(validatorKinds);
    const overlapsLength =
      validatorKindSet.has('length') &&
      (validatorKindSet.has('minLength') || validatorKindSet.has('maxLength'));
    const overlapsNumeric =
      validatorKindSet.has('num') && (validatorKindSet.has('min') || validatorKindSet.has('max'));

    if (!overlapsLength && !overlapsNumeric) {
      continue;
    }

    const overlapMessages: string[] = [];
    if (overlapsLength) {
      overlapMessages.push('length with minLength/maxLength');
    }
    if (overlapsNumeric) {
      overlapMessages.push('num with min/max');
    }

    diagnostics.push(
      createDiagnostic({
        code: 'OVERLAPPING_FIELD_VALIDATOR',
        severity: 'warning',
        message: `Field "${fieldName}" has overlapping validator definitions (${overlapMessages.join(
          '; ',
        )}).`,
        source: {
          file: declaration.sourcePath,
          declaration: declaration.declaration.name,
          field: fieldName,
        },
      }),
    );
  }
};

const validateUnknownTypeReferences = (
  declaration: LoadedDeclaration<TableDeclaration | ObjectTypeDeclaration>,
  knownEnumNames: Set<string>,
  knownObjectTypeNames: Set<string>,
  knownTableNames: Set<string>,
  diagnostics: Diagnostic[],
): void => {
  for (const [fieldName, fieldDefinition] of Object.entries(declaration.declaration.fields)) {
    if (
      fieldDefinition.type.kind === 'enum' &&
      !knownEnumNames.has(fieldDefinition.type.enumName)
    ) {
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
    if (
      !BUILT_IN_TABLE_FIELD_NAMES.includes(fieldName as (typeof BUILT_IN_TABLE_FIELD_NAMES)[number])
    ) {
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

const validateTableCompositeConstraintGroup = (
  declaration: LoadedDeclaration<TableDeclaration>,
  constraints: CompositeConstraintDefinition[],
  group: 'index' | 'unique',
  diagnostics: Diagnostic[],
): void => {
  const knownColumns = new Set<string>([
    ...Object.keys(declaration.declaration.fields),
    ...BUILT_IN_TABLE_FIELD_NAMES,
  ]);
  const seenBySignature = new Set<string>();
  const seenNames = new Set<string>();

  for (const constraint of constraints) {
    if (constraint.columns.length < 2) {
      diagnostics.push(
        createDiagnostic({
          code: 'INVALID_COMPOSITE_CONSTRAINT',
          message: `Table "${declaration.declaration.name}" ${group} composite constraints require at least two columns.`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
          },
        }),
      );
      continue;
    }

    const unknownColumns = constraint.columns.filter((column) => !knownColumns.has(column));
    if (unknownColumns.length > 0) {
      diagnostics.push(
        createDiagnostic({
          code: 'UNKNOWN_COMPOSITE_CONSTRAINT_COLUMN',
          message: `Table "${declaration.declaration.name}" ${group} composite constraint references unknown columns (${unknownColumns.join(', ')}).`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
          },
        }),
      );
    }

    const signature = constraint.columns.join('|');
    if (seenBySignature.has(signature)) {
      diagnostics.push(
        createDiagnostic({
          code: 'DUPLICATE_COMPOSITE_CONSTRAINT',
          severity: 'warning',
          message: `Table "${declaration.declaration.name}" has duplicate ${group} composite constraint on (${constraint.columns.join(', ')}).`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
          },
        }),
      );
    }
    seenBySignature.add(signature);

    if (constraint.name) {
      if (seenNames.has(constraint.name)) {
        diagnostics.push(
          createDiagnostic({
            code: 'DUPLICATE_COMPOSITE_CONSTRAINT_NAME',
            message: `Table "${declaration.declaration.name}" defines duplicate ${group} composite constraint name "${constraint.name}".`,
            source: {
              file: declaration.sourcePath,
              declaration: declaration.declaration.name,
            },
          }),
        );
      }
      seenNames.add(constraint.name);
    }
  }
};

const validateTableCompositeConstraints = (
  declaration: LoadedDeclaration<TableDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  validateTableCompositeConstraintGroup(
    declaration,
    declaration.declaration.compositeIndexes,
    'index',
    diagnostics,
  );
  validateTableCompositeConstraintGroup(
    declaration,
    declaration.declaration.compositeUniques,
    'unique',
    diagnostics,
  );
};

const validateTableRenameHint = (
  declaration: LoadedDeclaration<TableDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  const renameFrom = declaration.declaration.renameFrom;
  if (!renameFrom) {
    return;
  }

  if (renameFrom === declaration.declaration.name) {
    diagnostics.push(
      createDiagnostic({
        code: 'REDUNDANT_TABLE_RENAME_HINT',
        severity: 'warning',
        message: `Table "${declaration.declaration.name}" has renameFrom("${renameFrom}") which is redundant and ignored.`,
        source: {
          file: declaration.sourcePath,
          declaration: declaration.declaration.name,
        },
      }),
    );
  }
};

const validateTableColumnRenameHints = (
  declaration: LoadedDeclaration<TableDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  const renameFromToField = new Map<string, string>();
  for (const [fieldName, fieldDefinition] of Object.entries(declaration.declaration.fields)) {
    const renameFrom = fieldDefinition.db.renameFrom;
    if (!renameFrom) {
      continue;
    }

    const existingField = renameFromToField.get(renameFrom);
    if (existingField && existingField !== fieldName) {
      diagnostics.push(
        createDiagnostic({
          code: 'CONFLICTING_COLUMN_RENAME_HINT',
          message: `Table "${declaration.declaration.name}" has multiple fields declaring renameFrom("${renameFrom}") (${existingField}, ${fieldName}).`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
            field: fieldName,
          },
        }),
      );
      continue;
    }

    renameFromToField.set(renameFrom, fieldName);
  }
};

const validateDuplicateTableRenameHintTargets = (
  project: LoadedSchemaProject,
  diagnostics: Diagnostic[],
): void => {
  const byRenameFrom = new Map<string, LoadedDeclaration<TableDeclaration>[]>();
  for (const declaration of project.declarations.tables) {
    const renameFrom = declaration.declaration.renameFrom;
    if (!renameFrom) {
      continue;
    }

    const entries = byRenameFrom.get(renameFrom) ?? [];
    entries.push(declaration);
    byRenameFrom.set(renameFrom, entries);
  }

  for (const [renameFrom, declarations] of byRenameFrom.entries()) {
    if (declarations.length < 2) {
      continue;
    }

    for (const declaration of declarations) {
      diagnostics.push(
        createDiagnostic({
          code: 'CONFLICTING_TABLE_RENAME_HINT',
          message: `Multiple tables declare renameFrom("${renameFrom}"). Only one table may claim a previous name.`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
          },
        }),
      );
    }
  }
};

const validateBucketRenameHint = (
  declaration: LoadedDeclaration<BucketDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  const renameFrom = declaration.declaration.renameFrom;
  if (!renameFrom) {
    return;
  }

  if (renameFrom === declaration.declaration.name) {
    diagnostics.push(
      createDiagnostic({
        code: 'REDUNDANT_BUCKET_RENAME_HINT',
        severity: 'warning',
        message: `Bucket "${declaration.declaration.name}" has renameFrom("${renameFrom}") which is redundant and ignored.`,
        source: {
          file: declaration.sourcePath,
          declaration: declaration.declaration.name,
        },
      }),
    );
  }
};

const validateDuplicateBucketRenameHintTargets = (
  project: LoadedSchemaProject,
  diagnostics: Diagnostic[],
): void => {
  const byRenameFrom = new Map<string, LoadedDeclaration<BucketDeclaration>[]>();
  for (const declaration of project.declarations.buckets) {
    const renameFrom = declaration.declaration.renameFrom;
    if (!renameFrom) {
      continue;
    }

    const entries = byRenameFrom.get(renameFrom) ?? [];
    entries.push(declaration);
    byRenameFrom.set(renameFrom, entries);
  }

  for (const [renameFrom, declarations] of byRenameFrom.entries()) {
    if (declarations.length < 2) {
      continue;
    }

    for (const declaration of declarations) {
      diagnostics.push(
        createDiagnostic({
          code: 'CONFLICTING_BUCKET_RENAME_HINT',
          message: `Multiple buckets declare renameFrom("${renameFrom}"). Only one bucket may claim a previous name.`,
          source: {
            file: declaration.sourcePath,
            declaration: declaration.declaration.name,
          },
        }),
      );
    }
  }
};

const validateBucketMimeTypeDuplicates = (
  declaration: LoadedDeclaration<BucketDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  const reduced = reduceMimeTypes(declaration.declaration.metadata.mimeType ?? []);
  const duplicates = new Set<string>([
    ...(declaration.declaration.metadata.duplicateMimeType ?? []),
    ...reduced.duplicates,
  ]);

  if (duplicates.size === 0) {
    return;
  }

  diagnostics.push(
    createDiagnostic({
      code: 'DUPLICATE_BUCKET_MIME_TYPE',
      severity: 'warning',
      message: `Bucket "${declaration.declaration.name}" declares duplicate mime types (${[
        ...duplicates,
      ].join(', ')}). Duplicates are ignored.`,
      source: {
        file: declaration.sourcePath,
        declaration: declaration.declaration.name,
      },
    }),
  );
};

const validateBucketMetadataSettingDuplicates = (
  declaration: LoadedDeclaration<BucketDeclaration>,
  diagnostics: Diagnostic[],
): void => {
  const duplicates = declaration.declaration.metadata.duplicateMetadataKeys ?? [];

  if (duplicates.length === 0) {
    return;
  }

  diagnostics.push(
    createDiagnostic({
      code: 'DUPLICATE_BUCKET_METADATA_SETTING',
      severity: 'warning',
      message: `Bucket "${declaration.declaration.name}" has metadata keys defined multiple times (${duplicates.join(
        ', ',
      )}). Later definitions win.`,
      source: {
        file: declaration.sourcePath,
        declaration: declaration.declaration.name,
      },
    }),
  );
};

const validateDuplicateDeclarationNames = (
  project: LoadedSchemaProject,
  diagnostics: Diagnostic[],
): void => {
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
  validateDuplicateTableRenameHintTargets(project, diagnostics);
  validateDuplicateBucketRenameHintTargets(project, diagnostics);
  for (const enumDeclaration of project.declarations.enums) {
    validateEnumMembers(enumDeclaration, diagnostics);
  }

  validateBucketMetadataOnNonBucketDeclarations(
    [...project.declarations.tables, ...project.declarations.types],
    diagnostics,
  );

  const knownTableNames = new Set(
    project.declarations.tables.map((entry) => entry.declaration.name),
  );
  const knownEnumNames = new Set(project.declarations.enums.map((entry) => entry.declaration.name));
  const knownObjectTypeNames = new Set(
    project.declarations.types.map((entry) => entry.declaration.name),
  );

  for (const tableDeclaration of project.declarations.tables) {
    validateCaseInsensitiveFieldNames(
      tableDeclaration.declaration.fields,
      tableDeclaration,
      diagnostics,
    );
    validateOwnerCardinality(tableDeclaration.declaration.fields, tableDeclaration, diagnostics);
    validateAuthInputDuplicates(tableDeclaration.declaration.auth, tableDeclaration, diagnostics);
    validateFieldDuplicateDefinitions(tableDeclaration, diagnostics);
    validateOnDeleteRequiresReferences(tableDeclaration, diagnostics);
    validateUnknownTypeReferences(
      tableDeclaration,
      knownEnumNames,
      knownObjectTypeNames,
      knownTableNames,
      diagnostics,
    );
    validateBuiltInFieldConflicts(tableDeclaration, diagnostics);
    validateTableRenameHint(tableDeclaration, diagnostics);
    validateTableColumnRenameHints(tableDeclaration, diagnostics);
    validateTableCompositeConstraints(tableDeclaration, diagnostics);
  }

  for (const bucketDeclaration of project.declarations.buckets) {
    validateAuthInputDuplicates(bucketDeclaration.declaration.auth, bucketDeclaration, diagnostics);
    validateBucketMimeTypeDuplicates(bucketDeclaration, diagnostics);
    validateBucketMetadataSettingDuplicates(bucketDeclaration, diagnostics);
    validateBucketRenameHint(bucketDeclaration, diagnostics);
  }

  for (const objectTypeDeclaration of project.declarations.types) {
    validateCaseInsensitiveFieldNames(
      objectTypeDeclaration.declaration.fields,
      objectTypeDeclaration,
      diagnostics,
    );
    validateObjectTypeFieldRules(objectTypeDeclaration, diagnostics);
    validateFieldDuplicateDefinitions(objectTypeDeclaration, diagnostics);
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
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    diagnostics,
  };
};
