import { auth, defineSchema, enumType, field, objectType, role, table } from '@oxe/schema-core';

export const admin = role('admin');

export const PostStatus = enumType('PostStatus', ['draft', 'published']);

export const Metadata = objectType('Metadata', {
  title: field.string().trim().maxLength(80),
  description: field.string().trim().maxLength(180).optional(),
});

export const User = table('User', {
  config: {
    dbName: 'app_users',
  },
  fields: {
    email: field.string().unique().email(),
    displayName: field.string().trim().minLength(2),
  },
});

export const Post = table('Post', {
  config: {
    dbName: 'app_posts',
  },
  auth: {
    read: auth.public,
    create: [admin],
    update: [admin, auth.owner],
  },
  fields: {
    authorId: field.id().owner().references(User).index(),
    title: field.string().trim().length(3, 120),
    body: field.string(),
    status: field.enum(PostStatus).default('draft'),
    metadata: field.type(Metadata).optional(),
    metadataHistory: field.type(Metadata).array().optional(),
    tags: field.string().array(),
  },
});

export default defineSchema({
  roles: [admin],
  enums: [PostStatus],
  types: [Metadata],
  tables: [User, Post],
});
