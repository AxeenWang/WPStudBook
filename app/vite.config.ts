import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
