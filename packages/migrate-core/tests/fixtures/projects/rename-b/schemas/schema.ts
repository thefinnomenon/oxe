import { defineSchema, field, table } from '@oxe/schema-core';

export const Account = table('Account', {
  fields: {
    email: field.string().unique().email(),
    displayName: field.string().trim().minLength(2),
  },
});

export const Post = table('Post', {
  fields: {
    headline: field.string().trim().minLength(1),
  },
});

export default defineSchema({
  tables: [Account, Post],
});
