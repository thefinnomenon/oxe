import { auth, defineSchema, field, role, table } from '@oxe/schema-core';
import { Post, User } from './schema.js';

export const moderator = role('moderator');

export const Comment = table('Comment', {
  auth: {
    get: auth.public,
    getMany: auth.public,
    create: [moderator, auth.owner],
    update: [moderator, auth.owner],
    delete: [moderator, auth.owner],
  },
  fields: {
    postId: field.id().references(Post).index(),
    authorId: field.id().owner().references(User).index(),
    body: field.string().trim().minLength(1).maxLength(2000),
  },
});

export default defineSchema({
  roles: [moderator],
  tables: [Comment],
});
