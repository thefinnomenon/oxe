import type { AuthInput } from './auth.js';
import type { TransformDefinition, ValidatorDefinition } from './custom.js';

export type ScalarFieldType =
  | 'id'
  | 'string'
  | 'boolean'
  | 'int'
  | 'float'
  | 'decimal'
  | 'datetime'
  | 'date'
  | 'time'
  | 'json'
  | 'bytes';

export type OnDeleteBehavior = 'cascade' | 'restrict' | 'setNull';

export interface FieldTypeScalar {
  kind: 'scalar';
  scalar: ScalarFieldType;
}

export interface FieldTypeEnum {
  kind: 'enum';
  enumName: string;
}

export interface FieldTypeObject {
  kind: 'object';
  objectTypeName: string;
}

export type FieldTypeRef = FieldTypeScalar | FieldTypeEnum | FieldTypeObject;

export type BuiltInTransformKind =
  | 'trim'
  | 'lowercase'
  | 'uppercase'
  | 'floor'
  | 'ceiling'
  | 'round';

export type FieldTransform =
  | {
      kind: 'builtIn';
      name: BuiltInTransformKind;
    }
  | {
      kind: 'custom';
      name: TransformDefinition['name'];
    };

export type FieldValidator =
  | { kind: 'minLength'; value: number }
  | { kind: 'maxLength'; value: number }
  | { kind: 'length'; min: number; max: number }
  | { kind: 'email' }
  | { kind: 'url' }
  | { kind: 'uuid' }
  | { kind: 'regex'; source: string; flags: string }
  | { kind: 'min'; value: number }
  | { kind: 'max'; value: number }
  | { kind: 'num'; min: number; max: number }
  | { kind: 'custom'; name: ValidatorDefinition['name'] };

export interface FieldDbMetadata {
  primary: boolean;
  renameFrom?: string;
  defaultValue?: unknown;
  unique: boolean;
  index: boolean;
  references?: string;
  onDelete?: OnDeleteBehavior;
  autoUpdated: boolean;
}

export interface FieldDefinition {
  kind: 'field';
  type: FieldTypeRef;
  optional: boolean;
  array: boolean;
  auth?: AuthInput;
  owner: boolean;
  transforms: FieldTransform[];
  validators: FieldValidator[];
  db: FieldDbMetadata;
}

export const createEmptyDbMetadata = (): FieldDbMetadata => ({
  primary: false,
  unique: false,
  index: false,
  autoUpdated: false,
});

export const cloneFieldDefinition = (definition: FieldDefinition): FieldDefinition => ({
  ...definition,
  transforms: [...definition.transforms],
  validators: [...definition.validators],
  db: { ...definition.db },
});
