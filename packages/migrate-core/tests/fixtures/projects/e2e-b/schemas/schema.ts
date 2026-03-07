import { auth, defineSchema, enumType, field, objectType, role, table } from '@oxe/schema-core';

export const admin = role('admin');
export const moderator = role('moderator');

export const PostStatus = enumType('PostStatus', ['draft', 'published', 'archived']);

export const Metadata = objectType('Metadata', {
  title: field.string().trim().maxLength(80),
  description: field.string().trim().maxLength(180).optional(),
});

export const User = table('User', {
  fields: {
    email: field.string().unique().email(),
    displayName: field.string().trim().minLength(2),
    bio: field.string().optional(),
  },
});

export const Post = table('Post', {
  auth: {
    read: auth.public,
    create: [admin],
    update: [admin, moderator, auth.owner],
  },
  fields: {
    authorId: field.id().owner().references(User).onDelete('cascade').index(),
    title: field.string().trim().length(3, 120),
    summary: field.string().optional(),
    status: field.enum(PostStatus).default('published'),
    metadata: field.type(Metadata).optional(),
    metadataHistory: field.type(Metadata).array().optional(),
    tags: field.string().array(),
  },
});

export const Comment = table('Comment', {
  fields: {
    postId: field.id().references(Post).index(),
    authorId: field.id().references(User).index(),
    body: field.string().minLength(1),
  },
});

export default defineSchema({
  roles: [admin, moderator],
  enums: [PostStatus],
  types: [Metadata],
  tables: [User, Post, Comment],
});
