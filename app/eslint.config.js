// The @ts-check pragma is intentionally omitted here: eslint-plugin-react-hooks 7.1.1's
// types are not assignable to ESLint 10's Plugin type (restore once upstream fixes it).
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { layerConfigs } from './eslint.layers.js';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'tests/fixtures/generated/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/main.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // 端到端測試從 tests/e2e/fixtures.ts 取得 test，才會檢查主控台錯誤。
    files: ['tests/e2e/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              importNames: ['test'],
              allowTypeImports: true,
              message: '從 ./fixtures.ts 匯入 test：每個端到端測試都要檢查主控台錯誤。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'module' },
  },
  ...layerConfigs,
);
