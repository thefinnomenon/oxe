export const SCHEMA_DECLARATION_SYMBOL = Symbol.for('@oxe/schema-core/declaration');
export const SCHEMA_DEFINITION_SYMBOL = Symbol.for('@oxe/schema-core/definition');

export type DeclarationKind = 'table' | 'bucket' | 'role' | 'enum' | 'objectType';

export interface BrandedDeclaration {
  readonly [SCHEMA_DECLARATION_SYMBOL]: true;
  readonly declarationKind: DeclarationKind;
  readonly name: string;
}

export interface BrandedSchemaDefinition {
  readonly [SCHEMA_DEFINITION_SYMBOL]: true;
  readonly declarationKind: 'schema';
}

export const isSchemaDeclaration = (value: unknown): value is BrandedDeclaration => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as Record<PropertyKey, unknown>)[SCHEMA_DECLARATION_SYMBOL] === true;
};

export const isSchemaDefinition = (value: unknown): value is BrandedSchemaDefinition => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as Record<PropertyKey, unknown>)[SCHEMA_DEFINITION_SYMBOL] === true;
};
