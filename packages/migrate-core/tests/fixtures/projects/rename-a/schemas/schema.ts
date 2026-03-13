import { defineSchema, field, table } from '@oxe/schema-core';

export const User = table('User', {
  fields: {
    email: field.string().unique().email(),
    displayName: field.string().trim().minLength(2),
  },
});

export const Post = table('Post', {
  fields: {
    title: field.string().trim().minLength(1),
  },
});

export default defineSchema({
  tables: [User, Post],
});
