import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: 'WPStudBook.html',
    },
  },
});
