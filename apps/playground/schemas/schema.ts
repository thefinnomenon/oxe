import { auth, bucket, defineSchema, enumType, field, objectType, role, table } from '@oxe/schema-core';

export const admin = role('admin');

export const PostStatus = enumType('PostStatus', ['draft', 'published', 'archived']);

export const SEO = objectType('SEO', {
  title: field.string().trim().maxLength(70),
  description: field.string().trim().maxLength(160),
});

export const User = table('User', {
  fields: {
    email: field.string().email().unique(),
    displayName: field.string().trim().minLength(2),
  },
});

export const Post = table('Post', {
  auth: {
    read: auth.public,
    create: auth.private,
    update: [admin, auth.owner],
    delete: [admin, auth.owner],
  },
  fields: {
    authorId: field.id().owner().references(User).index(),
    title: field.string().trim().length(3, 120),
    body: field.string(),
    internalNotes: field.string().optional().auth({
      get: [admin, auth.owner],
      getMany: [admin],
      update: [admin],
    }),
    status: field.enum(PostStatus).default('draft'),
    seo: field.type(SEO).optional(),
    tags: field.string().array(),
  },
});

export const PostAssets = bucket('PostAssets', {
  auth: {
    read: auth.public,
    create: [admin, auth.owner],
    update: [admin, auth.owner],
    delete: [admin, auth.owner],
  },
  fields: {
    ownerId: field.id().owner().references(User).index(),
    postId: field.id().references(Post).index(),
    altText: field.string().trim().maxLength(140).optional(),
  },
})
  .image()
  .fileType('image/png', 'image/jpeg', 'image/webp')
  .size('1MB', '1GB')
  .dimensions(320, 320, 4096, 4096)
  .ttl('30d');

export default defineSchema({
  roles: [admin],
  enums: [PostStatus],
  types: [SEO],
  tables: [Post, User],
  buckets: [PostAssets],
});
