import { field, table } from '../../../../../src/index.js';

export const Post = table('Post', {
  fields: {
    authorId: field.id().references('User').index(),
    visibility: field.enum('Visibility'),
    title: field.string().trim().length(3, 120),
  },
});
