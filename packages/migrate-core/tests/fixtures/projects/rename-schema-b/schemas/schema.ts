import { field, table } from '@oxe/schema-core';

export const Account = table('Account', {
  renameFrom: 'User',
  fields: {
    name: field.string(),
  },
});

export const Post = table('Post', {
  fields: {
    headline: field.string().renameFrom('title'),
  },
});
