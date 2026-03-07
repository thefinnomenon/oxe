import { defineAuthCheck, defineTransform, defineValidator } from '@oxe/schema-core';

/** Custom transform that normalizes free text into a URL slug. */
export const slugify = defineTransform<string>('slugify', (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-'),
);

/** Custom validator that enforces slug format and returns a user-facing error message. */
export const isSlug = defineValidator<string>('isSlug', (value) =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    ? true
    : 'Slug must be lowercase alphanumeric words separated by hyphens.',
);

/** Custom auth check used by post update/delete actions. */
export const canManagePost = defineAuthCheck('canManagePost', (ctx) =>
  ctx.action === 'create' && ctx.user ? true : 'You do not have permission to manage this post.',
);
