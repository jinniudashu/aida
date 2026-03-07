import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: 'client',
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
})
