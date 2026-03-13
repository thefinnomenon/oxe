import { defineSchema, field, table } from '@oxe/schema-core';

export const User = table('User', {
  fields: {
    fullName: field.string().trim().minLength(2),
    email: field.string().unique().email(),
    age: field.int().optional(),
  },
});

export default defineSchema({
  tables: [User],
});
