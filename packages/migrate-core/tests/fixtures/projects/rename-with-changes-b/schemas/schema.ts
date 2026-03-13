import { defineSchema, field, table } from '@oxe/schema-core';

export const Player = table('Player', {
  fields: {
    displayName: field.string().trim().minLength(2),
    email: field.string().unique().email(),
    nickname: field.string().optional(),
  },
});

export default defineSchema({
  tables: [Player],
});
