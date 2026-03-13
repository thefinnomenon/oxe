import { bucket } from '@oxe/schema-core';

export const PostAssets = bucket('PostAssets', {
  config: {
    fileType: ['image/*'],
    fileNamePolicy: {
      strategy: 'slugify-uuid',
    },
    size: ['1MB', '10MB'],
    ttl: '7d',
  },
});
