import type { AuthInput } from './auth.js';
import {
  SCHEMA_DECLARATION_SYMBOL,
  SCHEMA_DEFINITION_SYMBOL,
  isSchemaDeclaration,
} from './brands.js';
import type { BrandedDeclaration, BrandedSchemaDefinition, DeclarationKind } from './brands.js';
import { toFieldDefinition, type FieldInput } from './field-builder.js';
import type { FieldDefinition } from './field-types.js';
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
  auth?: AuthInput;
  fields: Record<string, FieldDefinition>;
}

export interface BucketDimensions {
  width: number;
  height: number;
}

export interface BucketMetadata {
  mediaType?: 'image' | 'video';
  fileTypes?: string[];
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
}

export interface BucketDeclaration extends BrandedDeclaration {
  declarationKind: 'bucket';
  name: string;
  auth?: AuthInput;
  fields: Record<string, FieldDefinition>;
  metadata: BucketMetadata;
}

export type TopLevelDeclaration =
  | TableDeclaration
  | BucketDeclaration
  | RoleDeclaration
  | EnumDeclaration
  | ObjectTypeDeclaration;

export interface SchemaDefinitionInput {
  roles?: RoleDeclaration[];
  enums?: EnumDeclaration[];
  types?: ObjectTypeDeclaration[];
  tables?: TableDeclaration[];
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
  auth?: AuthInput;
  fields?: Record<string, FieldInput>;
}

export interface TableConfig extends BaseResourceConfig {
  fields: Record<string, FieldInput>;
}

export interface BucketConfig extends BaseResourceConfig {
  fields?: Record<string, FieldInput>;
}

const normalizeFields = (fields: Record<string, FieldInput> | undefined): Record<string, FieldDefinition> => {
  if (!fields) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(fields).map(([fieldName, fieldValue]) => [fieldName, toFieldDefinition(fieldValue)]),
  );
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
      throw new Error('Bucket dimensions require both width and height when using numeric overload.');
    }

    return { width: widthOrDimensions, height: maybeHeight };
  }

  return widthOrDimensions;
};

export class BucketDeclarationBuilder implements BucketDeclaration {
  public readonly [SCHEMA_DECLARATION_SYMBOL] = true;
  public readonly declarationKind = 'bucket' as const;

  public readonly name: string;
  public readonly auth?: AuthInput;
  public readonly fields: Record<string, FieldDefinition>;
  public readonly metadata: BucketMetadata;

  constructor(name: string, config: BucketConfig, metadata: BucketMetadata = {}) {
    this.name = name;
    this.auth = config.auth;
    this.fields = normalizeFields(config.fields);
    this.metadata = metadata;
  }

  public image(): BucketDeclarationBuilder {
    return this.withMetadata({ mediaType: 'image' });
  }

  public video(): BucketDeclarationBuilder {
    return this.withMetadata({ mediaType: 'video' });
  }

  public fileType(...fileTypes: string[]): BucketDeclarationBuilder {
    return this.withMetadata({
      fileTypes: [...(this.metadata.fileTypes ?? []), ...fileTypes],
    });
  }

  public minSize(min: SizeInput): BucketDeclarationBuilder {
    const minBytes = toSizeBytes(min);
    return this.withMetadata({
      size: { ...this.metadata.size, min: minBytes },
    });
  }

  public maxSize(max: SizeInput): BucketDeclarationBuilder {
    const maxBytes = toSizeBytes(max);
    return this.withMetadata({
      size: { ...this.metadata.size, max: maxBytes },
    });
  }

  public size(min: SizeInput, max: SizeInput): BucketDeclarationBuilder {
    const minBytes = toSizeBytes(min);
    const maxBytes = toSizeBytes(max);
    return this.withMetadata({
      size: { min: minBytes, max: maxBytes },
    });
  }

  public minDuration(min: DurationInput): BucketDeclarationBuilder {
    const minSeconds = toDurationSeconds(min);
    return this.withMetadata({
      duration: { ...this.metadata.duration, min: minSeconds },
    });
  }

  public maxDuration(max: DurationInput): BucketDeclarationBuilder {
    const maxSeconds = toDurationSeconds(max);
    return this.withMetadata({
      duration: { ...this.metadata.duration, max: maxSeconds },
    });
  }

  public duration(min: DurationInput, max: DurationInput): BucketDeclarationBuilder {
    const minSeconds = toDurationSeconds(min);
    const maxSeconds = toDurationSeconds(max);
    return this.withMetadata({
      duration: { min: minSeconds, max: maxSeconds },
    });
  }

  public minDimensions(widthOrDimensions: number | BucketDimensions, maybeHeight?: number): BucketDeclarationBuilder {
    const min = toDimensions(widthOrDimensions, maybeHeight);
    return this.withMetadata({
      dimensions: { ...this.metadata.dimensions, min },
    });
  }

  public maxDimensions(widthOrDimensions: number | BucketDimensions, maybeHeight?: number): BucketDeclarationBuilder {
    const max = toDimensions(widthOrDimensions, maybeHeight);
    return this.withMetadata({
      dimensions: { ...this.metadata.dimensions, max },
    });
  }

  public dimensions(
    minWidthOrDimensions: number | BucketDimensions,
    minHeightOrMaxDimensions: number | BucketDimensions,
    maybeMaxWidth?: number,
    maybeMaxHeight?: number,
  ): BucketDeclarationBuilder {
    if (
      typeof minWidthOrDimensions === 'number' &&
      typeof minHeightOrMaxDimensions === 'number' &&
      typeof maybeMaxWidth === 'number' &&
      typeof maybeMaxHeight === 'number'
    ) {
      return this.withMetadata({
        dimensions: {
          min: { width: minWidthOrDimensions, height: minHeightOrMaxDimensions },
          max: { width: maybeMaxWidth, height: maybeMaxHeight },
        },
      });
    }

    if (
      typeof minWidthOrDimensions === 'object' &&
      minWidthOrDimensions !== null &&
      typeof minHeightOrMaxDimensions === 'object' &&
      minHeightOrMaxDimensions !== null
    ) {
      return this.withMetadata({
        dimensions: {
          min: minWidthOrDimensions,
          max: minHeightOrMaxDimensions,
        },
      });
    }

    throw new Error('Bucket dimensions() expects either (minW, minH, maxW, maxH) or (min, max).');
  }

  public ttl(value: DurationInput): BucketDeclarationBuilder {
    return this.withMetadata({ ttlSeconds: toDurationSeconds(value) });
  }

  private withMetadata(metadataPatch: Partial<BucketMetadata>): BucketDeclarationBuilder {
    return new BucketDeclarationBuilder(
      this.name,
      { auth: this.auth, fields: this.fields },
      {
        ...this.metadata,
        ...metadataPatch,
      },
    );
  }
}

export const role = (name: string): RoleDeclaration => createDeclarationBase('role', { name });

export const enumType = (name: string, members: readonly string[]): EnumDeclaration =>
  createDeclarationBase('enum', { name, members: [...members] });

export const objectType = (name: string, fields: Record<string, FieldInput>): ObjectTypeDeclaration =>
  createDeclarationBase('objectType', {
    name,
    fields: normalizeFields(fields),
  });

export const table = (name: string, config: TableConfig): TableDeclaration =>
  createDeclarationBase('table', {
    name,
    auth: config.auth,
    fields: normalizeFields(config.fields),
  });

export const bucket = (name: string, config: BucketConfig = {}): BucketDeclarationBuilder =>
  new BucketDeclarationBuilder(name, config);

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
