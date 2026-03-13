import { field, table } from '@oxe/schema-core';

export const User = table('User', {
  fields: {
    name: field.string(),
  },
});

export const Post = table('Post', {
  fields: {
    title: field.string(),
  },
});
