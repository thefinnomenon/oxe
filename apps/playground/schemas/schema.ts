import { auth, bucket, enumType, field, objectType, role, table } from '@oxe/schema-core';
import { canManagePost, isSlug, slugify } from './custom-logic.js';

/** Admin role used in table and field auth policies. */
export const admin = role('admin');

/** Lifecycle status values for posts. */
export const PostStatus = enumType('PostStatus', ['draft', 'published', 'archived']);

/** Shared SEO object type embedded in posts. */
export const SEO = objectType('SEO', {
  title: field.string().trim().maxLength(70),
  description: field.string().trim().maxLength(160),
});

/** Application user table. */
export const User = table('User', {
  fields: {
    email: field.string().unique().email(),
    displayName: field.string().trim().minLength(2),
  },
});

/** Post table showing custom auth checks, transforms, and validators. */
export const Post = table('Post', {
  crud: ['read', 'create', 'delete'],
  auth: {
    read: auth.public,
    create: auth.private,
    update: [admin, auth.owner, canManagePost],
    delete: [admin, auth.owner, canManagePost],
  },
  fields: {
    authorId: field.id().owner().references(User).index(),
    title: field.string().trim().length(3, 120),
    slug: field.string().unique().transform(slugify).validate(isSlug),
    body: field.string(),
    internalNotes: field
      .string()
      .optional()
      .auth({
        get: [admin, auth.owner],
        getMany: [admin],
      }),
    status: field.enum(PostStatus).default('draft'),
    seo: field.type(SEO).optional(),
    tags: field.string().length(10, 100).array(),
  },
  config: {
    timestamps: true,
    description:
      'Table representing blog posts with custom auth rules, validation, and transforms.',
    tags: ['blog', 'content'],
  },
});

/** Bucket for post-related uploaded assets. */
export const PostAssets = bucket('PostAssets', {
  crud: false,
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
  config: {
    fileType: ['audio/*'],
    size: ['1MB', '1GB'],
    dimensions: [320, 320, 4096, 4096],
    ttl: '30d',
  },
});
