import { enumType, field, role, table } from '../../../../../src/index.js';

export const admin = role('admin');
export const Visibility = enumType('Visibility', ['public', 'private']);

export const User = table('User', {
  fields: {
    name: field.string().trim().minLength(2),
  },
});
