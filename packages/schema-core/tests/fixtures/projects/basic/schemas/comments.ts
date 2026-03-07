import { field, table } from '../../../../../src/index.js';

export const Comment = table('Comment', {
  auth: {
    get: 'public',
    getMany: 'public',
    create: ['member'],
    update: ['admin', 'owner'],
    delete: ['admin', 'owner'],
  },
  fields: {
    postId: field.id().references('Post').index(),
    authorId: field.id().references('User').index(),
    body: field.string().trim().minLength(1),
  },
});
