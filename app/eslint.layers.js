// @ts-check
import tseslint from 'typescript-eslint';

const LAYER_MESSAGE = '違反分層規則（設計決策第 4 節）';

/**
 * @param {string} layer
 * @param {boolean} [allowTypeImports]
 */
function layerImport(layer, allowTypeImports = false) {
  return {
    regex: `^(\\.{1,2}/)+(.*/)?${layer}(/|$)`,
    allowTypeImports,
    message: `${LAYER_MESSAGE}：不可引用 ${layer} 層${allowTypeImports ? '的值，只能 import type' : ''}`,
  };
}

const REACT_PACKAGES = {
  group: [
    'react',
    'react/*',
    'react-dom',
    'react-dom/*',
    'react-aria-components',
    '@tanstack/react-virtual',
  ],
  message: `${LAYER_MESSAGE}：只有 ui 層可以使用 React`,
};

const IDB_PACKAGE = {
  group: ['idb'],
  message: `${LAYER_MESSAGE}：此層不可使用 idb`,
};

const BROWSER_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'indexedDB',
  'localStorage',
  'sessionStorage',
  'fetch',
  'crypto',
  'CompressionStream',
  'DecompressionStream',
].map((name) => ({ name, message: `${LAYER_MESSAGE}：domain 層不可使用瀏覽器全域物件` }));

/** @type {import('eslint').Linter.Config[]} */
export const layerConfigs = [
  {
    name: 'wpstudbook/layers/setup',
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
  },
  {
    name: 'wpstudbook/layers/domain',
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', ...BROWSER_GLOBALS],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            layerImport('import'),
            layerImport('storage'),
            layerImport('services'),
            layerImport('ui'),
            REACT_PACKAGES,
            IDB_PACKAGE,
          ],
        },
      ],
    },
  },
  {
    name: 'wpstudbook/layers/import',
    files: ['src/import/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            layerImport('storage'),
            layerImport('services'),
            layerImport('ui'),
            REACT_PACKAGES,
            IDB_PACKAGE,
          ],
        },
      ],
    },
  },
  {
    name: 'wpstudbook/layers/storage',
    files: ['src/storage/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            layerImport('domain', true),
            layerImport('import'),
            layerImport('services'),
            layerImport('ui'),
            REACT_PACKAGES,
          ],
        },
      ],
    },
  },
  {
    name: 'wpstudbook/layers/services',
    files: ['src/services/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [layerImport('ui'), REACT_PACKAGES] },
      ],
    },
  },
  {
    name: 'wpstudbook/layers/ui',
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            layerImport('domain', true),
            layerImport('storage'),
            layerImport('import'),
            IDB_PACKAGE,
          ],
        },
      ],
    },
  },
];
