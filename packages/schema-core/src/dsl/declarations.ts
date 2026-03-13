import type { AuthInput } from './auth.js';
import type { CrudInput } from './crud.js';
import {
  SCHEMA_DECLARATION_SYMBOL,
  SCHEMA_DEFINITION_SYMBOL,
  isSchemaDeclaration,
} from './brands.js';
import type { BrandedDeclaration, BrandedSchemaDefinition, DeclarationKind } from './brands.js';
import { toFieldDefinition, type FieldInput } from './field-builder.js';
import type { FieldDefinition } from './field-types.js';
import { reduceMimeTypes, type MimeType } from './mime-types.js';
import { toDurationSeconds, toSizeBytes, type DurationInput, type SizeInput } from './units.js';

export interface RoleDeclaration extends BrandedDeclaration {
  declarationKind: 'role';
  name: string;
}

export interface EnumDeclaration extends BrandedDeclaration {
  declarationKind: 'enum';
  name: string;
  members: string[];
}

export interface ObjectTypeDeclaration extends BrandedDeclaration {
  declarationKind: 'objectType';
  name: string;
  fields: Record<string, FieldDefinition>;
}

export interface TableDeclaration extends BrandedDeclaration {
  declarationKind: 'table';
  name: string;
  renameFrom?: string;
  auth?: AuthInput;
  crud?: CrudInput;
  fields: Record<string, FieldDefinition>;
  compositeIndexes: CompositeConstraintDefinition[];
  compositeUniques: CompositeConstraintDefinition[];
  metadata: TableMetadata;
}

export interface BucketDimensions {
  /** Pixel width. */
  width: number;
  /** Pixel height. */
  height: number;
}

/** Strategy used to derive object keys from uploaded filenames. */
export type BucketFileNameStrategy = 'preserve' | 'uuid' | 'slugify' | 'slugify-uuid';

/** Extension handling policy for stored object keys. */
export type BucketFileExtensionMode = 'preserve' | 'infer' | 'none';

export interface BucketFileNamePolicy {
  /** Name generation strategy for uploaded files. */
  strategy: BucketFileNameStrategy;
  /** Whether to preserve, infer, or drop file extensions in generated keys. */
  extension: BucketFileExtensionMode;
  /** Lowercase generated filenames when true. */
  lowercase: boolean;
  /** Separator used by slug-based strategies. */
  separator: '-' | '_';
  /** Optional max filename length before extension handling. */
  maxLength?: number;
}

/** Output image formats supported by built-in post-upload image processing. */
export type BucketImageFormat = 'jpeg' | 'png' | 'webp' | 'avif';

/** Resize fit mode for generated variants. */
export type BucketImageResizeFit = 'cover' | 'contain' | 'inside' | 'outside';

export interface BucketImageVariant {
  /** Variant identifier, e.g. `thumb` or `hero`. */
  name: string;
  /** Target width in pixels. */
  width: number;
  /** Optional target height in pixels. */
  height?: number;
  /** Optional fit mode for this variant. */
  fit?: BucketImageResizeFit;
  /** Optional quality override (typically 1..100). */
  quality?: number;
  /** Optional format override for this variant. */
  format?: BucketImageFormat;
}

export interface BucketImageOptimization {
  /** Default optimization quality (typically 1..100). */
  quality?: number;
  /** Output formats to generate during optimization. */
  formats?: BucketImageFormat[];
  /** Remove EXIF/metadata payloads when true. */
  stripMetadata?: boolean;
}

export interface BucketImageResizeConfig {
  /** Clamp original uploads to this max width when set. */
  maxWidth?: number;
  /** Clamp original uploads to this max height when set. */
  maxHeight?: number;
  /** Named derivative variants to generate. */
  variants?: BucketImageVariant[];
}

/** Placeholder representation strategy for image previews. */
export type BucketPlaceholderKind = 'blurhash' | 'lqip' | 'dominantColor';

export interface BucketPlaceholderConfig {
  /** Placeholder algorithm to generate. */
  kind?: BucketPlaceholderKind;
  /** Target placeholder width in pixels where applicable. */
  width?: number;
  /** Optional quality tuning for placeholder encoding. */
  quality?: number;
}

export interface BucketResponsiveImagesConfig {
  /** Target responsive widths in pixels (sorted/deduped internally). */
  breakpoints: number[];
  /** Output formats to emit for responsive variants. */
  formats?: BucketImageFormat[];
  /** Quality used for responsive derivatives. */
  quality?: number;
  /** Also include placeholder metadata in responsive outputs. */
  includePlaceholder?: boolean;
}

export interface BucketPostUploadConfig {
  /** Global image optimization defaults. */
  optimizeImages?: BucketImageOptimization;
  /** Resize limits and derivative variant definitions. */
  imageResize?: BucketImageResizeConfig;
  /** Placeholder generation options. */
  placeholders?: BucketPlaceholderConfig;
  /** Multi-size responsive image generation settings. */
  responsiveImages?: BucketResponsiveImagesConfig;
}

export interface BucketMetadata {
  mimeType?: string[];
  duplicateMimeType?: string[];
  duplicateMetadataKeys?: string[];
  size?: {
    min?: number;
    max?: number;
  };
  duration?: {
    min?: number;
    max?: number;
  };
  dimensions?: {
    min?: BucketDimensions;
    max?: BucketDimensions;
  };
  ttlSeconds?: number;
  /** Normalized filename/key policy for uploaded files. */
  fileNamePolicy?: BucketFileNamePolicy;
  /** Normalized post-upload processing directives. */
  postUpload?: BucketPostUploadConfig;
}

export interface BucketDeclaration extends BrandedDeclaration {
  declarationKind: 'bucket';
  name: string;
  renameFrom?: string;
  auth?: AuthInput;
  crud?: CrudInput;
  metadata: BucketMetadata;
}

export type TopLevelDeclaration =
  | TableDeclaration
  | BucketDeclaration
  | RoleDeclaration
  | EnumDeclaration
  | ObjectTypeDeclaration;

export interface SchemaDefinitionInput {
  /** Role declarations included in this schema module. */
  roles?: RoleDeclaration[];
  /** Enum declarations included in this schema module. */
  enums?: EnumDeclaration[];
  /** Object type declarations included in this schema module. */
  types?: ObjectTypeDeclaration[];
  /** Table declarations included in this schema module. */
  tables?: TableDeclaration[];
  /** Bucket declarations included in this schema module. */
  buckets?: BucketDeclaration[];
}

export interface SchemaDefinition extends BrandedSchemaDefinition {
  declarationKind: 'schema';
  roles: RoleDeclaration[];
  enums: EnumDeclaration[];
  types: ObjectTypeDeclaration[];
  tables: TableDeclaration[];
  buckets: BucketDeclaration[];
}

interface BaseResourceConfig {
  /** Resource-level auth rules. */
  auth?: AuthInput;
  /** CRUD route generation controls. */
  crud?: CrudInput;
}

export interface TableMetadata {
  /** Optional physical table name override for persistence layers. */
  dbName?: string;
  /** Optional description for docs/admin tooling. */
  description?: string;
  /** Arbitrary tags for downstream tooling/filtering. */
  tags?: string[];
  /** Whether built-in timestamp fields are expected on this table. */
  timestamps?: boolean;
}

export interface TableMetadataInput extends Omit<TableMetadata, 'tags'> {
  /** Arbitrary tags for downstream tooling/filtering. */
  tags?: readonly string[];
}

export interface TableConfig extends BaseResourceConfig {
  /** Table field map. */
  fields: Record<string, FieldInput>;
  /** Optional previous declaration name for non-interactive rename planning. */
  renameFrom?: string;
  /** Table-level composite indexes (multi-column). */
  indexes?: CompositeConstraintInput[];
  /** Table-level composite unique constraints (multi-column). */
  unique?: CompositeConstraintInput[];
  /** Table-level composite unique constraints (multi-column). */
  uniques?: CompositeConstraintInput[];
  /** Table metadata/config authored in schemas. */
  config?: TableMetadataInput;
}

export interface BucketConfig extends BaseResourceConfig {
  /** Optional previous declaration name for non-interactive rename planning. */
  renameFrom?: string;
  /** Bucket upload constraints and processing config. */
  config?: BucketMetadataInput;
}

export type BucketDimensionsInput = BucketDimensions | [width: number, height: number];

export type BucketDimensionsRangeInput =
  | BucketDimensionsInput
  | [min: BucketDimensionsInput, max: BucketDimensionsInput]
  | [minWidth: number, minHeight: number, maxWidth: number, maxHeight: number];

export interface BucketFileNamePolicyInput extends Partial<Omit<BucketFileNamePolicy, 'strategy'>> {
  /** Name generation strategy for uploaded files. */
  strategy: BucketFileNameStrategy;
}

export interface BucketImageVariantInput extends Omit<BucketImageVariant, 'name' | 'width'> {
  /** Variant identifier, e.g. `thumb` or `hero`. */
  name: string;
  /** Target width in pixels. */
  width: number;
}

export interface BucketImageOptimizationInput extends Omit<BucketImageOptimization, 'formats'> {
  /** Output formats to generate during optimization. */
  formats?: readonly BucketImageFormat[];
}

export interface BucketImageResizeConfigInput extends Omit<BucketImageResizeConfig, 'variants'> {
  /** Named derivative variants to generate. */
  variants?: readonly BucketImageVariantInput[];
}

export interface BucketResponsiveImagesConfigInput extends Omit<
  BucketResponsiveImagesConfig,
  'breakpoints' | 'formats'
> {
  /** Target responsive widths in pixels. */
  breakpoints: readonly number[];
  /** Output formats to emit for responsive variants. */
  formats?: readonly BucketImageFormat[];
}

export interface BucketPostUploadConfigInput {
  /** Global image optimization defaults. */
  optimizeImages?: BucketImageOptimizationInput;
  /** Resize limits and derivative variant definitions. */
  imageResize?: BucketImageResizeConfigInput;
  /** Placeholder generation options. */
  placeholders?: BucketPlaceholderConfig;
  /** Multi-size responsive image generation settings. */
  responsiveImages?: BucketResponsiveImagesConfigInput;
}

export interface CompositeConstraintDefinition {
  columns: string[];
  name?: string;
}

export type CompositeConstraintColumnsInput = readonly [
  first: string,
  second: string,
  ...rest: string[],
];

export type CompositeConstraintInput =
  | CompositeConstraintColumnsInput
  | {
      /** Optional explicit DB name for this index/constraint. */
      name?: string;
      /** Ordered column names in this composite key/index. */
      columns: CompositeConstraintColumnsInput;
    };

export interface BucketMetadataInput {
  /** Allowed mime types for uploaded objects. Supports wildcards like `image/*`. */
  fileType?: MimeType[];
  /** Naming policy applied to uploaded files. */
  fileNamePolicy?: BucketFileNamePolicyInput;
  /** Minimum allowed file size. */
  minSize?: SizeInput;
  /** Maximum allowed file size. */
  maxSize?: SizeInput;
  /** Exact size or min/max size range. */
  size?: SizeInput | [min: SizeInput, max: SizeInput];
  /** Minimum allowed media duration. */
  minDuration?: DurationInput;
  /** Maximum allowed media duration. */
  maxDuration?: DurationInput;
  /** Exact duration or min/max duration range. */
  duration?: DurationInput | [min: DurationInput, max: DurationInput];
  /** Minimum width/height bounds. */
  minDimensions?: BucketDimensionsInput;
  /** Maximum width/height bounds. */
  maxDimensions?: BucketDimensionsInput;
  /** Exact dimensions or min/max dimension range. */
  dimensions?: BucketDimensionsRangeInput;
  /** Time-to-live for stored objects. */
  ttl?: DurationInput;
  /** Post-upload media processing directives. */
  postUpload?: BucketPostUploadConfigInput;
}

const normalizeFields = (
  fields: Record<string, FieldInput> | undefined,
): Record<string, FieldDefinition> => {
  if (!fields) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(fields).map(([fieldName, fieldValue]) => [
      fieldName,
      toFieldDefinition(fieldValue),
    ]),
  );
};

const normalizeTableMetadataInput = (input: TableMetadataInput | undefined): TableMetadata => {
  if (!input) {
    return {};
  }

  const tags = input.tags ? [...new Set(input.tags)] : undefined;
  return {
    dbName: input.dbName,
    description: input.description,
    timestamps: input.timestamps,
    tags: tags && tags.length > 0 ? tags : undefined,
  };
};

const normalizeCompositeConstraint = (
  input: CompositeConstraintInput,
): CompositeConstraintDefinition => {
  if (Array.isArray(input)) {
    return {
      columns: [...new Set<string>(input)],
    };
  }

  const objectInput = input as Extract<
    CompositeConstraintInput,
    { columns: CompositeConstraintColumnsInput }
  >;
  return {
    name: objectInput.name,
    columns: [...new Set<string>(objectInput.columns)],
  };
};

const normalizeCompositeConstraints = (
  input: CompositeConstraintInput[] | undefined,
): CompositeConstraintDefinition[] => {
  if (!input || input.length === 0) {
    return [];
  }

  return input.map((entry) => normalizeCompositeConstraint(entry));
};

const createDeclarationBase = <TKind extends DeclarationKind, TPayload extends object>(
  declarationKind: TKind,
  payload: TPayload,
): TPayload & { declarationKind: TKind; readonly [SCHEMA_DECLARATION_SYMBOL]: true } => ({
  ...payload,
  declarationKind,
  [SCHEMA_DECLARATION_SYMBOL]: true,
});

const toDimensions = (
  widthOrDimensions: number | BucketDimensions,
  maybeHeight?: number,
): BucketDimensions => {
  if (typeof widthOrDimensions === 'number') {
    if (typeof maybeHeight !== 'number') {
      throw new Error(
        'Bucket dimensions require both width and height when using numeric overload.',
      );
    }

    return { width: widthOrDimensions, height: maybeHeight };
  }

  return widthOrDimensions;
};

const toDimensionsFromInput = (input: BucketDimensionsInput): BucketDimensions =>
  Array.isArray(input) ? toDimensions(input[0], input[1]) : toDimensions(input);

const appendMimeTypes = (
  metadata: BucketMetadata,
  mimeTypesToAppend: string[],
): Pick<BucketMetadata, 'mimeType' | 'duplicateMimeType'> => {
  const reduced = reduceMimeTypes([...(metadata.mimeType ?? []), ...mimeTypesToAppend]);
  const duplicates = new Set([...(metadata.duplicateMimeType ?? []), ...reduced.duplicates]);

  return {
    mimeType: reduced.mimeType,
    duplicateMimeType: duplicates.size > 0 ? [...duplicates] : undefined,
  };
};

type BucketMetadataKey =
  | 'size.min'
  | 'size.max'
  | 'duration.min'
  | 'duration.max'
  | 'dimensions.min'
  | 'dimensions.max'
  | 'ttlSeconds';

const hasBucketMetadataValue = (metadata: BucketMetadata, key: BucketMetadataKey): boolean => {
  switch (key) {
    case 'size.min':
      return metadata.size?.min !== undefined;
    case 'size.max':
      return metadata.size?.max !== undefined;
    case 'duration.min':
      return metadata.duration?.min !== undefined;
    case 'duration.max':
      return metadata.duration?.max !== undefined;
    case 'dimensions.min':
      return metadata.dimensions?.min !== undefined;
    case 'dimensions.max':
      return metadata.dimensions?.max !== undefined;
    case 'ttlSeconds':
      return metadata.ttlSeconds !== undefined;
    default:
      return false;
  }
};

const trackBucketMetadataOverrides = (
  metadata: BucketMetadata,
  keys: BucketMetadataKey[],
): Pick<BucketMetadata, 'duplicateMetadataKeys'> => {
  const duplicates = new Set(metadata.duplicateMetadataKeys ?? []);

  for (const key of keys) {
    if (hasBucketMetadataValue(metadata, key)) {
      duplicates.add(key);
    }
  }

  return {
    duplicateMetadataKeys: duplicates.size > 0 ? [...duplicates] : undefined,
  };
};

const normalizeBucketFileNamePolicyInput = (
  input: BucketFileNamePolicyInput | undefined,
): BucketFileNamePolicy | undefined => {
  if (!input) {
    return undefined;
  }

  return {
    strategy: input.strategy,
    extension: input.extension ?? 'preserve',
    lowercase: input.lowercase ?? true,
    separator: input.separator ?? '-',
    maxLength: input.maxLength,
  };
};

const normalizeBucketPostUploadInput = (
  input: BucketPostUploadConfigInput | undefined,
): BucketPostUploadConfig | undefined => {
  if (!input) {
    return undefined;
  }

  const optimizeImages = input.optimizeImages
    ? {
        quality: input.optimizeImages.quality,
        stripMetadata: input.optimizeImages.stripMetadata,
        formats: input.optimizeImages.formats
          ? [...new Set(input.optimizeImages.formats)]
          : undefined,
      }
    : undefined;

  const imageResize = input.imageResize
    ? {
        maxWidth: input.imageResize.maxWidth,
        maxHeight: input.imageResize.maxHeight,
        variants: input.imageResize.variants?.map((variant) => ({
          name: variant.name,
          width: variant.width,
          height: variant.height,
          fit: variant.fit,
          quality: variant.quality,
          format: variant.format,
        })),
      }
    : undefined;

  const placeholders = input.placeholders
    ? {
        kind: input.placeholders.kind,
        width: input.placeholders.width,
        quality: input.placeholders.quality,
      }
    : undefined;

  const responsiveImages = input.responsiveImages
    ? {
        breakpoints: [...new Set(input.responsiveImages.breakpoints)].sort((a, b) => a - b),
        formats: input.responsiveImages.formats
          ? [...new Set(input.responsiveImages.formats)]
          : undefined,
        quality: input.responsiveImages.quality,
        includePlaceholder: input.responsiveImages.includePlaceholder,
      }
    : undefined;

  if (!optimizeImages && !imageResize && !placeholders && !responsiveImages) {
    return undefined;
  }

  return {
    optimizeImages,
    imageResize,
    placeholders,
    responsiveImages,
  };
};

const normalizeBucketMetadataInput = (input: BucketMetadataInput | undefined): BucketMetadata => {
  if (!input) {
    return {};
  }

  let metadata: BucketMetadata = {};
  if (input.fileType && input.fileType.length > 0) {
    metadata = { ...metadata, ...appendMimeTypes(metadata, input.fileType) };
  }
  if (input.fileNamePolicy) {
    metadata = {
      ...metadata,
      fileNamePolicy: normalizeBucketFileNamePolicyInput(input.fileNamePolicy),
    };
  }

  if (input.minSize !== undefined) {
    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['size.min']),
      size: { ...metadata.size, min: toSizeBytes(input.minSize) },
    };
  }
  if (input.maxSize !== undefined) {
    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['size.max']),
      size: { ...metadata.size, max: toSizeBytes(input.maxSize) },
    };
  }
  if (input.size !== undefined) {
    const min = Array.isArray(input.size) ? input.size[0] : input.size;
    const max = Array.isArray(input.size) ? input.size[1] : input.size;
    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['size.min', 'size.max']),
      size: { min: toSizeBytes(min), max: toSizeBytes(max) },
    };
  }

  if (input.minDuration !== undefined) {
    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['duration.min']),
      duration: { ...metadata.duration, min: toDurationSeconds(input.minDuration) },
    };
  }
  if (input.maxDuration !== undefined) {
    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['duration.max']),
      duration: { ...metadata.duration, max: toDurationSeconds(input.maxDuration) },
    };
  }
  if (input.duration !== undefined) {
    const min = Array.isArray(input.duration) ? input.duration[0] : input.duration;
    const max = Array.isArray(input.duration) ? input.duration[1] : input.duration;
    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['duration.min', 'duration.max']),
      duration: { min: toDurationSeconds(min), max: toDurationSeconds(max) },
    };
  }

  if (input.minDimensions !== undefined) {
    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['dimensions.min']),
      dimensions: { ...metadata.dimensions, min: toDimensionsFromInput(input.minDimensions) },
    };
  }
  if (input.maxDimensions !== undefined) {
    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['dimensions.max']),
      dimensions: { ...metadata.dimensions, max: toDimensionsFromInput(input.maxDimensions) },
    };
  }
  if (input.dimensions !== undefined) {
    let min: BucketDimensions;
    let max: BucketDimensions;
    if (Array.isArray(input.dimensions)) {
      if (input.dimensions.length === 2) {
        min = toDimensionsFromInput(input.dimensions[0] as BucketDimensionsInput);
        max = toDimensionsFromInput(input.dimensions[1] as BucketDimensionsInput);
      } else if (input.dimensions.length === 4) {
        min = toDimensions(input.dimensions[0], input.dimensions[1]);
        max = toDimensions(input.dimensions[2], input.dimensions[3]);
      } else {
        throw new Error(
          'Bucket metadata.dimensions expects [w,h], [min,max], or [minW,minH,maxW,maxH].',
        );
      }
    } else {
      min = toDimensionsFromInput(input.dimensions);
      max = toDimensionsFromInput(input.dimensions);
    }

    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['dimensions.min', 'dimensions.max']),
      dimensions: { min, max },
    };
  }

  if (input.ttl !== undefined) {
    metadata = {
      ...metadata,
      ...trackBucketMetadataOverrides(metadata, ['ttlSeconds']),
      ttlSeconds: toDurationSeconds(input.ttl),
    };
  }

  if (input.postUpload !== undefined) {
    metadata = {
      ...metadata,
      postUpload: normalizeBucketPostUploadInput(input.postUpload),
    };
  }

  return metadata;
};

/** Declares a reusable role token for auth rules. */
export const role = (name: string): RoleDeclaration => createDeclarationBase('role', { name });

/** Declares an enum type with ordered string members. */
export const enumType = (name: string, members: readonly string[]): EnumDeclaration =>
  createDeclarationBase('enum', { name, members: [...members] });

/** Declares an object type (structured value object) with nested fields. */
export const objectType = (
  name: string,
  fields: Record<string, FieldInput>,
): ObjectTypeDeclaration =>
  createDeclarationBase('objectType', {
    name,
    fields: normalizeFields(fields),
  });

/** Declares a table resource with fields and optional table-level auth. */
export const table = (name: string, config: TableConfig): TableDeclaration =>
  createDeclarationBase('table', {
    name,
    renameFrom: config.renameFrom,
    auth: config.auth,
    crud: config.crud,
    fields: normalizeFields(config.fields),
    compositeIndexes: normalizeCompositeConstraints(config.indexes),
    compositeUniques: normalizeCompositeConstraints(config.uniques ?? config.unique),
    metadata: normalizeTableMetadataInput(config.config),
  });

/** Declares a bucket resource with auth/crud and upload config metadata. */
export const bucket = (name: string, options: BucketConfig = {}): BucketDeclaration =>
  createDeclarationBase('bucket', {
    name,
    renameFrom: options.renameFrom,
    auth: options.auth,
    crud: options.crud,
    metadata: normalizeBucketMetadataInput(options.config),
  });

/**
 * Combines top-level declarations into a default schema module export.
 * @param input Declaration groups to include in the schema module.
 */
export const defineSchema = (input: SchemaDefinitionInput): SchemaDefinition => ({
  declarationKind: 'schema',
  [SCHEMA_DEFINITION_SYMBOL]: true,
  roles: [...(input.roles ?? [])],
  enums: [...(input.enums ?? [])],
  types: [...(input.types ?? [])],
  tables: [...(input.tables ?? [])],
  buckets: [...(input.buckets ?? [])],
});

export const isTopLevelDeclaration = (value: unknown): value is TopLevelDeclaration => {
  if (!isSchemaDeclaration(value)) {
    return false;
  }

  return (
    value.declarationKind === 'table' ||
    value.declarationKind === 'bucket' ||
    value.declarationKind === 'role' ||
    value.declarationKind === 'enum' ||
    value.declarationKind === 'objectType'
  );
};
