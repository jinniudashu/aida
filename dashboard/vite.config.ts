import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: resolve(__dirname, 'client'),
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
  },
})
