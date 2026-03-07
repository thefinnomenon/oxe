import { field, table } from '../../../../../src/index.js';

export const DuplicateUser = table('User', {
  fields: {
    email: field.string().email(),
  },
});
