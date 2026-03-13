import { bucket } from '@oxe/schema-core';

export const UserAvatar = bucket('UserAvatar', {
  config: {
    fileNamePolicy: {
      strategy: 'slugify',
    },
  },
});
