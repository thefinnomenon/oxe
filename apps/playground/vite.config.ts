import { fileURLToPath, URL } from 'node:url';

import { defineConfig, searchForWorkspaceRoot } from 'vite';

import { oxeSizePlugin } from './src/size-plugin.js';

const fromRepositoryRoot = (path: string): string =>
  fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig({
  plugins: [oxeSizePlugin({ repositoryRoot: fromRepositoryRoot('') })],
  build: {
    rollupOptions: {
      input: {
        playground: fileURLToPath(new URL('./index.html', import.meta.url)),
        preview: fileURLToPath(new URL('./preview.html', import.meta.url)),
      },
    },
    target: 'es2022',
  },
  resolve: {
    alias: {
      '@oxe/compiler': fromRepositoryRoot('packages/compiler/src/index.ts'),
      '@oxe/graph': fromRepositoryRoot('packages/graph/src/index.ts'),
      '@oxe/runtime': fromRepositoryRoot('packages/runtime/src/index.ts'),
      '@oxe/runtime-dom': fromRepositoryRoot('packages/runtime-dom/src/index.ts'),
    },
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(fileURLToPath(new URL('.', import.meta.url)))],
    },
  },
});
