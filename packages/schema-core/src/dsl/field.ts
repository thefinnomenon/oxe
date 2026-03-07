import type { EnumDeclaration, ObjectTypeDeclaration } from './declarations.js';
import { createFieldBuilder } from './field-builder.js';
import type { ScalarFieldType } from './field-types.js';

const scalar = (scalarType: ScalarFieldType) => createFieldBuilder({ kind: 'scalar', scalar: scalarType });

const resolveEnumName = (value: EnumDeclaration | string): string =>
  typeof value === 'string' ? value : value.name;

const resolveObjectTypeName = (value: ObjectTypeDeclaration | string): string =>
  typeof value === 'string' ? value : value.name;

export const field = {
  id: () => scalar('id'),
  string: () => scalar('string'),
  boolean: () => scalar('boolean'),
  int: () => scalar('int'),
  float: () => scalar('float'),
  decimal: () => scalar('decimal'),
  datetime: () => scalar('datetime'),
  date: () => scalar('date'),
  time: () => scalar('time'),
  json: () => scalar('json'),
  bytes: () => scalar('bytes'),
  enum: (enumDeclarationOrName: EnumDeclaration | string) =>
    createFieldBuilder({ kind: 'enum', enumName: resolveEnumName(enumDeclarationOrName) }),
  type: (objectTypeDeclarationOrName: ObjectTypeDeclaration | string) =>
    createFieldBuilder({ kind: 'object', objectTypeName: resolveObjectTypeName(objectTypeDeclarationOrName) }),
} as const;
