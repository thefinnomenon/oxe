import { bucket, defineSchema } from '../../../../../src/index.js';

export const Assets = bucket('Assets', {
  config: {
    fileType: ['image/*', 'image/png', 'image/png', 'video/*', 'video/*'],
  },
});

export default defineSchema({
  buckets: [Assets],
});
