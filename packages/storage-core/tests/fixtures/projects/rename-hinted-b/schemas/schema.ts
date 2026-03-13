import { bucket } from '@oxe/schema-core';

export const Avatar = bucket('Avatar', {
  renameFrom: 'UserAvatar',
  config: {
    fileNamePolicy: {
      strategy: 'slugify',
    },
  },
});
