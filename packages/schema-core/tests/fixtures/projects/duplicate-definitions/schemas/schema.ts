import { bucket, defineSchema, field, table } from '../../../../../src/index.js';

export const Post = table('Post', {
  auth: {
    read: ['public'],
    get: ['public'],
    update: ['admin', 'owner'],
    delete: ['admin', 'admin'],
  },
  fields: {
    title: field
      .string()
      .auth({
        read: ['admin'],
        get: ['admin'],
        update: ['admin', 'admin'],
      })
      .trim()
      .minLength(3)
      .minLength(5)
      .length(3, 120)
      .maxLength(120),
    internalNotes: field
      .string()
      .optional()
      .auth({
        update: ['admin', 'owner'],
      }),
    score: field.int().min(1).max(10).num(1, 10),
  },
});

export const Assets = bucket('Assets', {
  config: {
    minSize: '100KB',
    maxSize: '10MB',
    size: ['1MB', '8MB'],
    minDimensions: [100, 100],
    dimensions: [320, 320, 1920, 1080],
    ttl: '2h',
  },
});

export default defineSchema({
  tables: [Post],
  buckets: [Assets],
});
