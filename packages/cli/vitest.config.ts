import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      '@oxe/schema-core': path.resolve(__dirname, '../schema-core/src/index.ts'),
      '@oxe/migrate-core': path.resolve(__dirname, '../migrate-core/src/index.ts'),
      '@oxe/storage-core': path.resolve(__dirname, '../storage-core/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
