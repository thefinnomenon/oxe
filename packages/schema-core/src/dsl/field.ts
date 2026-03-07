import type { EnumDeclaration, ObjectTypeDeclaration } from './declarations.js';
import { createFieldBuilder } from './field-builder.js';
import type { ScalarFieldType } from './field-types.js';

const scalar = (scalarType: ScalarFieldType) =>
  createFieldBuilder({ kind: 'scalar', scalar: scalarType });

const resolveEnumName = (value: EnumDeclaration | string): string =>
  typeof value === 'string' ? value : value.name;

const resolveObjectTypeName = (value: ObjectTypeDeclaration | string): string =>
  typeof value === 'string' ? value : value.name;

export const field = {
  /** UUID-like identifier field. */
  id: () => scalar('id'),
  /** Text/string field. */
  string: () => scalar('string'),
  /** Boolean field. */
  boolean: () => scalar('boolean'),
  /** Integer field. */
  int: () => scalar('int'),
  /** Floating-point field. */
  float: () => scalar('float'),
  /** Arbitrary-precision decimal field. */
  decimal: () => scalar('decimal'),
  /** Date-time field. */
  datetime: () => scalar('datetime'),
  /** Date-only field. */
  date: () => scalar('date'),
  /** Time-only field. */
  time: () => scalar('time'),
  /** JSON value field. */
  json: () => scalar('json'),
  /** Binary/bytes field. */
  bytes: () => scalar('bytes'),
  /** Enum field using a declared enum or enum name. */
  enum: (enumDeclarationOrName: EnumDeclaration | string) =>
    createFieldBuilder({ kind: 'enum', enumName: resolveEnumName(enumDeclarationOrName) }),
  /** Object field using a declared object type or object type name. */
  type: (objectTypeDeclarationOrName: ObjectTypeDeclaration | string) =>
    createFieldBuilder({
      kind: 'object',
      objectTypeName: resolveObjectTypeName(objectTypeDeclarationOrName),
    }),
} as const;
