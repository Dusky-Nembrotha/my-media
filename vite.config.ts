import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': 'http://localhost:4123' },
  },
})
