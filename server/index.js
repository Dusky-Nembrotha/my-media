import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { router as library } from './routes/library.js'
import { router as recs } from './routes/recs.js'
import { router as stats } from './routes/stats.js'
import { router as imports } from './routes/imports.js'
import { router as misc } from './routes/misc.js'
import { router as connections } from './routes/connections.js'
import { router as auth } from './routes/auth.js'
import { requireAuth, applyEnvPassword } from './lib/auth.js'
import { queueAll, queueAllRecArtwork } from './enrich.js'

const app = express()
const PORT = Number(process.env.PORT || 4123)
const root = join(import.meta.dirname, '..')
const dist = join(root, 'dist')

app.use(express.json({ limit: '5mb' }))
app.disable('x-powered-by')
// Fly (and any reverse proxy) terminates TLS for us; trust it so that client
// IPs and the https flag are read from the forwarding headers.
app.set('trust proxy', true)

// A deployment given MYMEDIA_PASSWORD is never open, even on first boot.
if (applyEnvPassword()) console.log('  password set from MYMEDIA_PASSWORD')

app.use('/api', auth)
app.use('/api', requireAuth)
app.use('/api', library)
app.use('/api', recs)
app.use('/api', stats)
app.use('/api', imports)
app.use('/api', misc)
app.use('/api', connections)

app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` }))
app.use((err, req, res, next) => {
  console.error('[api error]', err)
  if (res.headersSent) return next(err)
  res.status(500).json({ error: err.message || 'Something went wrong' })
})

if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }))
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')))
} else {
  app.get('/', (req, res) => res.status(503).type('html').send(
    '<pre style="font:14px ui-monospace;padding:2rem;color:#eee;background:#111">'
    + 'My Media: the client is not built yet.\n\nRun  npm run build  then reload,\n'
    + 'or  npm run dev  for the hot-reloading dev server on :5173.</pre>',
  ))
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  My Media — http://localhost:${PORT}`)
  console.log(`  On your network: http://<this-machine>:${PORT}\n`)

  // The queue lives in memory, so pick up anything a restart interrupted.
  const pending = queueAll({ onlyMissing: true })
  queueAllRecArtwork()
  if (pending) console.log(`  resuming metadata for ${pending} titles\n`)
})
