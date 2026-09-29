import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { defineConfig } from 'vitest/config'

// 應用版本取自 package.json，建置與測試時注入（src/storage/version.ts）
const packageJson: { version: string } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
)

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [vue(), viteSingleFile({ removeViteModuleLoader: true })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: fileURLToPath(new URL('./WPStudBook.html', import.meta.url)),
    },
  },
  server: {
    open: '/WPStudBook.html',
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'tests/acceptance/**/*.test.ts',
      'tests/local/**/*.test.ts',
      '*.test.ts',
    ],
    environment: 'node',
  },
})
