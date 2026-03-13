import { bucket } from '@oxe/schema-core';

export const PostAssets = bucket('PostAssets', {
  config: {
    fileType: ['image/*', 'video/*'],
    fileNamePolicy: {
      strategy: 'slugify-uuid',
    },
    size: ['1MB', '10MB'],
    ttl: '14d',
  },
});

export const UserUploads = bucket('UserUploads', {
  config: {
    fileType: ['application/pdf'],
    fileNamePolicy: {
      strategy: 'uuid',
    },
  },
});
