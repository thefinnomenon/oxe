import { auth, defineSchema, field, role, table } from '../../../../../src/index.js';

export const admin = role('admin');

export const Post = table('Post', {
  auth: {
    create: auth.private,
    update: [admin, auth.owner],
  },
  fields: {
    authorId: field.id().owner(),
    internalNotes: field.string().optional().auth({
      create: auth.public,
    }),
  },
});

export default defineSchema({
  roles: [admin],
  tables: [Post],
});
