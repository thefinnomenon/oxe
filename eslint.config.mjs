import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    files: ['**/scripts/**/*.mjs', 'benchmarks/**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        Response: 'readonly',
        URL: 'readonly',
        WebSocket: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
      },
    },
  },
  {
    files: ['apps/playground/src/**/*.ts', 'apps/workspace/src/client.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
  },
);
