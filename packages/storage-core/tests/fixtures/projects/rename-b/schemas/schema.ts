import { bucket } from '@oxe/schema-core';

export const Avatar = bucket('Avatar', {
  config: {
    fileNamePolicy: {
      strategy: 'slugify',
    },
  },
});
