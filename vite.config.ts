import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serving the app under a sub-path (behind a reverse proxy, or on a shared
 * Tailscale Funnel port) needs the asset URLs to carry that prefix.
 *
 * It is read from the repo-root .env as well as the environment, so a plain
 * `npm run build` cannot silently produce a build for the wrong path — which
 * breaks every absolute asset URL in index.html.
 */
export default defineConfig(({ mode }) => {
  // fileURLToPath, not .pathname — the repo path contains spaces.
  const repoRoot = fileURLToPath(new URL('.', import.meta.url))
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env }
  const basePath = String(env.SHELVED_BASE_PATH || env.MYMEDIA_BASE_PATH || '').replace(/\/$/, '')

  return {
    base: basePath ? `${basePath}/` : '/',
    root: 'client',
    build: { outDir: '../dist', emptyOutDir: true },
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: { '/api': 'http://localhost:4123' },
    },
  }
})
