// @ts-check
import tseslint from 'typescript-eslint';

const LAYER_MESSAGE = '違反分層規則（設計決策第 4 節）';
const IO_MESSAGE =
  '違反成品限制（需求規格 14 章、BLD-04）：不可使用對外連線、裝置存取或直接存取檔案系統的 API';

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
  'crypto',
  'CompressionStream',
  'DecompressionStream',
].map((name) => ({ name, message: `${LAYER_MESSAGE}：domain 層不可使用瀏覽器全域物件` }));

const EXTERNAL_IO_NAMES = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'RTCPeerConnection',
  'showOpenFilePicker',
  'showSaveFilePicker',
  'showDirectoryPicker',
];

const EXTERNAL_IO_GLOBALS = EXTERNAL_IO_NAMES.map((name) => ({ name, message: IO_MESSAGE }));

const EXTERNAL_IO_PROPERTIES = [
  ...['window', 'globalThis', 'self'].flatMap((object) =>
    EXTERNAL_IO_NAMES.map((property) => ({ object, property, message: IO_MESSAGE })),
  ),
  ...['sendBeacon', 'serial', 'usb', 'hid', 'bluetooth'].map((property) => ({
    object: 'navigator',
    property,
    message: IO_MESSAGE,
  })),
];

/** @type {import('eslint').Linter.Config[]} */
export const layerConfigs = [
  {
    name: 'wpstudbook/layers/setup',
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
  },
  {
    name: 'wpstudbook/external-io',
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', ...EXTERNAL_IO_GLOBALS],
      'no-restricted-properties': ['error', ...EXTERNAL_IO_PROPERTIES],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message:
            '違反分層規則：src 不使用動態 import（成品是單一 HTML，且引用規則無法檢查動態 import）',
        },
      ],
    },
  },
  {
    name: 'wpstudbook/layers/domain',
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      // 同一規則在較後面的設定會整個取代前面的選項，所以 domain 要同時列出對外 I/O 的名稱。
      'no-restricted-globals': ['error', ...BROWSER_GLOBALS, ...EXTERNAL_IO_GLOBALS],
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
  {
    name: 'wpstudbook/layers/main',
    files: ['src/main.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            layerImport('domain'),
            layerImport('import'),
            layerImport('storage'),
            layerImport('services'),
            IDB_PACKAGE,
          ],
        },
      ],
    },
  },
];
