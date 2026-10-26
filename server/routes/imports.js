import { Router } from 'express'
import busboy from 'busboy'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { all, get, run } from '../lib/db.js'
import { explode, detect, parseWith, catalogue, getImporter } from '../importers/index.js'
import { applyRecords } from '../importers/apply.js'
import { guessMapping } from '../importers/generic.js'
import { state as enrichState, queueAll, queueAllRecArtwork, recState } from '../enrich.js'

export const router = Router()

/** Uploads live in memory between "analyse" and "import" so nothing re-uploads. */
const staged = new Map()
const STAGE_TTL_MS = 30 * 60 * 1000

function sweep() {
  const now = Date.now()
  for (const [token, entry] of staged) if (now - entry.at > STAGE_TTL_MS) staged.delete(token)
}

function receive(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: 300 * 1024 * 1024, files: 40 } })
    const files = []
    const fields = {}
    bb.on('file', (_name, stream, info) => {
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('limit', () => reject(new Error(`${info.filename} is larger than 300MB`)))
      stream.on('end', () => files.push({ filename: info.filename, buffer: Buffer.concat(chunks) }))
    })
    bb.on('field', (name, value) => { fields[name] = value })
    bb.on('error', reject)
    bb.on('close', () => resolve({ files, fields }))
    req.pipe(bb)
  })
}

router.get('/import/sources', (req, res) => {
  res.json({ sources: catalogue(), sampleAvailable: existsSync(samplesDir()) })
})

/** Step 1: work out what was uploaded and preview what would happen. */
router.post('/import/analyse', async (req, res) => {
  sweep()
  try {
    const { files: uploads } = await receive(req)
    if (!uploads.length) return res.status(400).json({ error: 'No files received' })

    const members = uploads.flatMap((u) => explode(u))
    if (!members.length) return res.status(400).json({ error: 'No readable CSV or JSON found in that upload' })

    const token = randomUUID()
    staged.set(token, { at: Date.now(), members, uploads: uploads.map((u) => u.filename) })

    const ranked = detect(members)
    const best = ranked[0]
    const previews = []
    for (const candidate of ranked.slice(0, 3)) {
      try {
        const { records, filesUsed } = parseWith(candidate.id, members)
        const dry = applyRecords(records, { source: candidate.id, dryRun: true })
        const used = new Set(filesUsed)
        previews.push({
          ...candidate,
          filesUsed,
          // Anything in the upload this importer will not read. Worth showing:
          // a silently skipped file looks exactly like missing data later.
          filesIgnored: members.map((m) => m.filename).filter((f) => !used.has(f)),
          total: records.length,
          entries: records.filter((r) => r.kind === 'entry').length,
          preview: dry,
        })
      } catch (err) {
        previews.push({ ...candidate, error: err.message })
      }
    }

    res.json({
      token,
      files: members.map((m) => ({
        filename: m.filename,
        archive: m.archive,
        headers: m.headers || null,
        rows: m.headers ? Math.max(0, m.text.split('\n').length - 1) : null,
        kind: m.json !== undefined ? 'json' : 'table',
        bytes: m.text.length,
      })),
      detected: best?.id || 'generic',
      candidates: previews,
      mapping: guessMapping(members.find((m) => m.headers)?.headers || []),
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

/** Step 2: commit it. */
router.post('/import/apply', async (req, res) => {
  sweep()
  const body = req.is('application/json') ? req.body : (await receive(req)).fields
  const { token, source } = body
  const stage = staged.get(token)
  if (!stage) return res.status(410).json({ error: 'That upload has expired — please choose the files again' })
  const importer = getImporter(source)
  if (!importer) return res.status(400).json({ error: `Unknown import source: ${source}` })

  let opts = body.options || {}
  if (typeof opts === 'string') { try { opts = JSON.parse(opts) } catch { opts = {} } }

  const runRow = run(
    "INSERT INTO import_runs (source, filename, status) VALUES (?, ?, 'running')",
    source, stage.uploads.join(', ').slice(0, 300),
  )
  const runId = Number(runRow.lastInsertRowid)

  try {
    const { records } = parseWith(source, stage.members, opts)
    const summary = applyRecords(records, {
      source,
      filename: stage.uploads.join(', '),
      enrich: opts.enrich !== false,
    })
    run(
      `UPDATE import_runs SET status = 'done', works_added = ?, entries_added = ?, entries_skipped = ?,
         recs_added = ?, detail = ?, finished_at = datetime('now') WHERE id = ?`,
      summary.worksAdded, summary.entriesAdded, summary.entriesSkipped, summary.recsAdded,
      JSON.stringify(summary), runId,
    )
    staged.delete(token)
    res.json({ ok: true, runId, summary })
  } catch (err) {
    run(
      "UPDATE import_runs SET status = 'failed', message = ?, finished_at = datetime('now') WHERE id = ?",
      err.message, runId,
    )
    res.status(500).json({ error: err.message })
  }
})

router.get('/import/runs', (req, res) => {
  res.json({
    runs: all('SELECT * FROM import_runs ORDER BY id DESC LIMIT 25').map((r) => ({
      ...r,
      detail: (() => { try { return JSON.parse(r.detail) } catch { return {} } })(),
    })),
    enrich: { pending: enrichState.pending, done: enrichState.done, failed: enrichState.failed, lastTitle: enrichState.lastTitle },
  })
})

function samplesDir() {
  return join(import.meta.dirname, '..', '..', 'samples')
}

/** One click to fill the app with the bundled demo exports. */
router.post('/import/samples', (req, res) => {
  const dir = samplesDir()
  if (!existsSync(dir)) return res.status(404).json({ error: 'No samples bundled with this install' })
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
  const groups = [
    ['letterboxd', walk(join(dir, 'letterboxd'))],
    ['goodreads', [join(dir, 'goodreads_library_export.csv')]],
    ['audible', [join(dir, 'Audible.Library.csv')]],
    ['imdb', [join(dir, 'imdb_ratings.csv')]],
    ['trakt', [join(dir, 'trakt_watched_shows.json')]],
    ['spotify', walk(join(dir, 'spotify'))],
    ['netflix', [join(dir, 'NetflixViewingHistory.csv')]],
  ]
  const summaries = []
  for (const [source, paths] of groups) {
    const existing = paths.filter((p) => existsSync(p))
    if (!existing.length) continue
    const members = existing.flatMap((p) => explode({ filename: relative(dir, p), buffer: readFileSync(p) }))
    const { records } = parseWith(source, members)
    const summary = applyRecords(records, { source, filename: 'bundled sample', enrich: false })
    run(
      `INSERT INTO import_runs (source, filename, status, works_added, entries_added, entries_skipped, recs_added, detail, finished_at)
       VALUES (?, 'bundled sample', 'done', ?, ?, ?, ?, ?, datetime('now'))`,
      source, summary.worksAdded, summary.entriesAdded, summary.entriesSkipped, summary.recsAdded, JSON.stringify(summary),
    )
    summaries.push({ source, ...summary })
  }
  const queued = queueAll({ onlyMissing: true })
  res.json({ ok: true, summaries, queuedForEnrichment: queued })
})

/* ------------------------------------------------------- metadata enrichment */

router.get('/enrich/status', (req, res) => {
  res.json({
    recsPending: recState.pending,
    pending: enrichState.pending,
    done: enrichState.done,
    failed: enrichState.failed,
    running: enrichState.running,
    lastTitle: enrichState.lastTitle,
    missingArtwork: get('SELECT count(*) c FROM works WHERE poster_url IS NULL').c,
    total: get('SELECT count(*) c FROM works').c,
  })
})

router.post('/enrich/recs', (req, res) => {
  res.json({ ok: true, pending: queueAllRecArtwork() })
})

router.post('/enrich', (req, res) => {
  const all = req.body?.all === true
  const pending = queueAll({
    onlyMissing: !all,
    force: all,
    type: req.body?.type && req.body.type !== 'all' ? req.body.type : undefined,
  })
  queueAllRecArtwork()
  res.json({ ok: true, pending })
})
