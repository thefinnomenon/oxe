export {
  bucket,
  BucketDeclarationBuilder,
  defineSchema,
  enumType,
  isTopLevelDeclaration,
  objectType,
  role,
  table,
  type BucketConfig,
  type BucketDeclaration,
  type BucketDimensions,
  type BucketMetadata,
  type EnumDeclaration,
  type ObjectTypeDeclaration,
  type RoleDeclaration,
  type SchemaDefinition,
  type SchemaDefinitionInput,
  type TableConfig,
  type TableDeclaration,
  type TopLevelDeclaration,
} from './dsl/declarations.js';

export {
  AUTH_ACTIONS,
  AUTH_SUBJECT_SYMBOL,
  AUTH_SUGAR_ACTIONS,
  auth,
  isAuthSubjectReference,
  isRoleSubjectReference,
  resolveAuthToken,
  type AuthAction,
  type AuthInput,
  type AuthSugarAction,
  type AuthSubjectReference,
  type AuthToken,
  type AuthValue,
  type RoleSubjectReference,
} from './dsl/auth.js';

export {
  field,
} from './dsl/field.js';

export {
  DURATION_UNITS,
  SIZE_UNITS,
  toDurationSeconds,
  toSizeBytes,
  units,
  type DurationInput,
  type DurationUnit,
  type SizeInput,
  type SizeUnit,
} from './dsl/units.js';

export {
  FieldBuilder,
  createFieldBuilder,
  toFieldDefinition,
  type FieldInput,
} from './dsl/field-builder.js';

export {
  type FieldDbMetadata,
  type FieldDefinition,
  type FieldTransform,
  type FieldTypeRef,
  type FieldValidator,
  type OnDeleteBehavior,
  type ScalarFieldType,
} from './dsl/field-types.js';

export {
  loadSchemaProject,
  type LoadedDeclaration,
  type LoadedSchemaModule,
  type LoadedSchemaProject,
  type LoadSchemaProjectOptions,
} from './loader/index.js';

export { validateSchemaProject, type SchemaValidationResult } from './semantics/index.js';

export {
  buildSchemaGraph,
  normalizeAuth,
  type NormalizedAuth,
  type NormalizedBucket,
  type NormalizedBucketMetadata,
  type NormalizedEnum,
  type NormalizedField,
  type NormalizedObjectType,
  type NormalizedRole,
  type NormalizedTable,
  type SchemaGraph,
  type SchemaGraphProvenance,
} from './graph/index.js';

export { createDiagnostic, formatDiagnostic, type Diagnostic, type DiagnosticSource } from './diagnostics/index.js';
