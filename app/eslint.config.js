import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

// 同一層的其他模組：@/storage/x、../storage/x 都算
const layer = (name) => ({
  regex: `(^|/)${name}(/|$)`,
  message: `不得引用 ${name} 模組（見 AGENTS.md 模組邊界）`,
})
const packages = (names, message) => ({ regex: `^(${names.join('|')})($|/)`, message })

export default defineConfigWithVueTs(
  { name: 'app/files-to-lint', files: ['**/*.{ts,mts,tsx,vue}'] },
  globalIgnores(['**/dist/**', '**/coverage/**', '**/test-results/**', '**/playwright-report/**']),
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    name: 'app/boundary-core',
    files: ['src/core/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            packages(
              ['vue', 'pinia', 'vue-router', 'dexie', 'reka-ui', '@tanstack'],
              'core 不得引用框架或資料庫套件',
            ),
            layer('ce-import'),
            layer('storage'),
            layer('ui'),
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'indexedDB',
        'localStorage',
        'sessionStorage',
      ],
    },
  },
  {
    name: 'app/boundary-ce-import',
    files: ['src/ce-import/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            packages(
              ['vue', 'pinia', 'vue-router', 'dexie', 'reka-ui'],
              'ce-import 不得引用框架或資料庫套件',
            ),
            layer('storage'),
            layer('ui'),
          ],
        },
      ],
    },
  },
  {
    name: 'app/boundary-storage',
    files: ['src/storage/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            packages(['vue', 'pinia', 'vue-router', 'reka-ui'], 'storage 不得引用畫面套件'),
            layer('ce-import'),
            layer('ui'),
          ],
        },
      ],
    },
  },
  skipFormatting,
)
