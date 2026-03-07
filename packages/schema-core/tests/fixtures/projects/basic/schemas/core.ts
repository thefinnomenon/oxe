import {
  bucket,
  defineSchema,
  enumType,
  field,
  objectType,
  role,
  table,
} from '../../../../../src/index.js';

export const admin = role('admin');
export const member = role('member');

export const PostStatus = enumType('PostStatus', ['draft', 'published', 'archived']);

export const SEO = objectType('SEO', {
  title: field.string().trim().maxLength(70),
  description: field.string().trim().maxLength(160),
});

export const User = table('User', {
  fields: {
    email: field.string().unique().email(),
    displayName: field.string().trim().minLength(2),
  },
});

export const Post = table('Post', {
  config: {
    dbName: 'posts',
    description: 'Primary posts table',
    tags: ['content', 'public-content'],
    timestamps: true,
  },
  crud: ['read', 'create', 'delete'],
  auth: {
    read: 'public',
    write: ['admin', 'owner'],
    delete: ['admin', 'owner'],
  },
  fields: {
    authorId: field.id().owner().references(User).index(),
    title: field.string().trim().length(3, 120),
    body: field.string(),
    status: field.enum(PostStatus).default('draft'),
    seo: field.type(SEO).optional(),
    tags: field.string().array(),
  },
});

export const Assets = bucket('Assets', {
  crud: false,
  auth: {
    read: 'private',
    write: ['admin'],
  },
  fields: {
    ownerId: field.id().owner().references('User'),
  },
  config: {
    fileType: ['image/*', 'image/png', 'image/jpeg'],
    size: [1, 5_000_000],
    dimensions: [300, 300, 3840, 2160],
    ttl: 3600,
  },
});

export const IgnoredByLoader = table('IgnoredByLoader', {
  fields: {
    value: field.string(),
  },
});

export default defineSchema({
  roles: [admin, member],
  enums: [PostStatus],
  types: [SEO],
  tables: [User, Post],
  buckets: [Assets],
});
