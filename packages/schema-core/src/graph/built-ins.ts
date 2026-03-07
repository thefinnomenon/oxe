import { createEmptyDbMetadata, type FieldDefinition } from '../dsl/field-types.js';

export type BuiltInTableFieldName = 'id' | 'createdAt' | 'updatedAt';

export const createBuiltInTableFields = (): Record<BuiltInTableFieldName, FieldDefinition> => ({
  id: {
    kind: 'field',
    type: { kind: 'scalar', scalar: 'id' },
    optional: false,
    array: false,
    owner: false,
    transforms: [],
    validators: [],
    db: {
      ...createEmptyDbMetadata(),
      primary: true,
      defaultValue: 'uuidv7',
    },
  },
  createdAt: {
    kind: 'field',
    type: { kind: 'scalar', scalar: 'datetime' },
    optional: false,
    array: false,
    owner: false,
    transforms: [],
    validators: [],
    db: {
      ...createEmptyDbMetadata(),
      defaultValue: 'now',
    },
  },
  updatedAt: {
    kind: 'field',
    type: { kind: 'scalar', scalar: 'datetime' },
    optional: false,
    array: false,
    owner: false,
    transforms: [],
    validators: [],
    db: {
      ...createEmptyDbMetadata(),
      defaultValue: 'now',
      autoUpdated: true,
    },
  },
});
