import { auth, field, role, table } from '@oxe/schema-core';
import { Post, User } from './schema.js';

/** Community moderator role for comment management. */
export const moderator = role('moderator');

/** Comment table connected to Post and User. */
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
