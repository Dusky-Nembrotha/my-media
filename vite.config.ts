import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Serving the app under a sub-path (behind a reverse proxy, or on a shared
// Tailscale Funnel port) needs the asset URLs to carry that prefix.
const basePath = (process.env.SHELVED_BASE_PATH || process.env.MYMEDIA_BASE_PATH || '').replace(/\/$/, '')

export default defineConfig({
  base: basePath ? `${basePath}/` : '/',
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': 'http://localhost:4123' },
  },
})
