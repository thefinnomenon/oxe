export {
  bucket,
  defineSchema,
  enumType,
  isTopLevelDeclaration,
  objectType,
  role,
  table,
  type BucketConfig,
  type BucketDeclaration,
  type BucketDimensions,
  type BucketDimensionsInput,
  type BucketDimensionsRangeInput,
  type BucketMetadata,
  type BucketMetadataInput,
  type EnumDeclaration,
  type ObjectTypeDeclaration,
  type RoleDeclaration,
  type SchemaDefinition,
  type SchemaDefinitionInput,
  type TableConfig,
  type TableDeclaration,
  type TableMetadata,
  type TableMetadataInput,
  type TopLevelDeclaration,
} from './dsl/declarations.js';

export {
  AUTH_ACTIONS,
  AUTH_CHECK_SYMBOL,
  AUTH_SUBJECT_SYMBOL,
  AUTH_SUGAR_ACTIONS,
  auth,
  defineAuthCheck,
  isAuthCheckReference,
  isAuthSubjectReference,
  isRoleSubjectReference,
  resolveAuthToken,
  type AuthAction,
  type AuthCheckReference,
  type AuthInput,
  type AuthSugarAction,
  type AuthSubjectReference,
  type AuthToken,
  type AuthValue,
  type RoleSubjectReference,
} from './dsl/auth.js';

export {
  CRUD_ACTIONS,
  CRUD_SUGAR_ACTIONS,
  type CrudAction,
  type CrudActionLike,
  type CrudInput,
  type CrudSugarAction,
} from './dsl/crud.js';

export {
  CUSTOM_TRANSFORM_SYMBOL,
  CUSTOM_VALIDATOR_SYMBOL,
  defineTransform,
  defineValidator,
  isTransformDefinition,
  isValidatorDefinition,
  type CustomExecutionContext,
  type AuthCheckReturn,
  type TransformDefinition,
  type UserContext,
  type ValidatorDefinition,
  type ValidatorReturn,
} from './dsl/custom.js';

export { field } from './dsl/field.js';

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

export { POPULAR_MIME_TYPES, type MimeType } from './dsl/mime-types.js';

export {
  FieldBuilder,
  createFieldBuilder,
  toFieldDefinition,
  type FieldInput,
} from './dsl/field-builder.js';

export {
  type BuiltInTransformKind,
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
  normalizeCrud,
  type NormalizedAuth,
  type NormalizedBucket,
  type NormalizedBucketMetadata,
  type NormalizedCrud,
  type NormalizedEnum,
  type NormalizedField,
  type NormalizedObjectType,
  type NormalizedRole,
  type NormalizedTable,
  type SchemaGraph,
  type SchemaGraphProvenance,
} from './graph/index.js';

export {
  createDiagnostic,
  formatDiagnostic,
  type Diagnostic,
  type DiagnosticSource,
} from './diagnostics/index.js';
