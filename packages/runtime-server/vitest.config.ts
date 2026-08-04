import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@oxe/compiler': new URL('../compiler/src/index.ts', import.meta.url).pathname,
      '@oxe/graph': new URL('../graph/src/index.ts', import.meta.url).pathname,
      '@oxe/runtime': new URL('../runtime/src/index.ts', import.meta.url).pathname,
      '@oxe/runtime-dom': new URL('../runtime-dom/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
