import { Router } from 'express'
import { all, get, run, json } from '../lib/db.js'
import { WORK_CARD_SQL, workWithStats, upsertWork, hydrate } from '../lib/works.js'
import { TYPES, SECTIONS, normaliseTitle, today, clamp } from '../lib/util.js'
import { searchProviders, searchAllTypes } from '../providers/index.js'
import { queueEnrichment, prioritise } from '../enrich.js'

export const router = Router()

const SORTS = {
  recent: 'last_on IS NULL, last_on DESC, updated_at DESC',
  added: 'created_at DESC',
  rating: 'rating IS NULL, rating DESC, last_on DESC',
  title: 'sort_title ASC',
  year: 'year IS NULL, year DESC',
  runtime: 'runtime IS NULL, runtime DESC',
}

function cardOf(row) {
  const w = hydrate(row)
  return {
    id: w.id,
    type: w.type,
    title: w.title,
    year: w.year,
    poster_url: w.poster_url,
    backdrop_url: w.backdrop_url,
    creators: w.creators.filter((c) => c.role !== 'Cast').slice(0, 2),
    genres: w.genres.slice(0, 3),
    rating: row.rating ?? null,
    liked: Boolean(row.liked),
    entry_count: row.entry_count ?? 0,
    last_on: row.last_on ?? null,
    status: row.status ?? null,
    runtime: w.runtime,
    pages: w.pages,
    external_rating: w.external_rating,
  }
}

/** GET /api/works — the grid behind every section page. */
router.get('/works', (req, res) => {
  const { type, q, genre, creator, status, sort = 'recent', year, decade } = req.query
  const limit = clamp(Number(req.query.limit) || 60, 1, 500)
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const minRating = req.query.minRating ? Number(req.query.minRating) : null
  const unrated = req.query.unrated === '1'

  const where = []
  const params = []
  if (type && type !== 'all') { where.push('w.type = ?'); params.push(type) }
  if (q) {
    where.push('(lower(w.title) LIKE ? OR lower(w.creators) LIKE ?)')
    params.push(`%${String(q).toLowerCase()}%`, `%${String(q).toLowerCase()}%`)
  }
  if (genre) { where.push('lower(w.genres) LIKE ?'); params.push(`%${String(genre).toLowerCase()}%`) }
  if (creator) { where.push('lower(w.creators) LIKE ?'); params.push(`%${String(creator).toLowerCase()}%`) }
  if (year) { where.push('w.year = ?'); params.push(Number(year)) }
  if (decade) {
    const d = Number(String(decade).replace('s', ''))
    where.push('w.year BETWEEN ? AND ?'); params.push(d, d + 9)
  }

  // The computed columns (rating, entry_count, status) only exist on the outer
  // query, so filter them there — SQLite will not accept HAVING without GROUP BY.
  const outer = []
  const outerParams = []
  if (minRating) { outer.push('rating >= ?'); outerParams.push(Number(minRating)) }
  if (unrated) outer.push('rating IS NULL')
  if (status === 'logged') outer.push('entry_count > 0')
  else if (status === 'unlogged') outer.push('entry_count = 0')
  else if (status) { outer.push('status = ?'); outerParams.push(String(status)) }

  const inner = `${WORK_CARD_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
  const filtered = `SELECT * FROM (${inner}) ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''}`

  const rows = all(
    `${filtered} ORDER BY ${SORTS[sort] || SORTS.recent} LIMIT ? OFFSET ?`,
    ...params, ...outerParams, limit, offset,
  )
  const total = get(`SELECT count(*) c FROM (${filtered})`, ...params, ...outerParams).c

  const cards = rows.map(cardOf)
  prioritise(cards)
  res.json({ works: cards, total, limit, offset })
})

/** Facets for the filter bar. */
router.get('/facets', (req, res) => {
  const type = req.query.type && req.query.type !== 'all' ? req.query.type : null
  const rows = all(
    `SELECT w.genres, w.creators, w.year FROM works w
      WHERE (? IS NULL OR w.type = ?) AND EXISTS (SELECT 1 FROM entries e WHERE e.work_id = w.id)`,
    type, type,
  )
  const genres = new Map()
  const creators = new Map()
  const decades = new Map()
  for (const r of rows) {
    for (const g of json(r.genres, [])) genres.set(g, (genres.get(g) || 0) + 1)
    for (const c of json(r.creators, [])) {
      if (c.role === 'Cast' || c.role === 'Contributor') continue
      const key = `${c.role}|${c.name}`
      creators.set(key, (creators.get(key) || 0) + 1)
    }
    if (r.year) {
      const d = `${Math.floor(r.year / 10) * 10}s`
      decades.set(d, (decades.get(d) || 0) + 1)
    }
  }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  res.json({
    genres: top(genres, 30).map(([name, count]) => ({ name, count })),
    creators: top(creators, 30).map(([key, count]) => ({ role: key.split('|')[0], name: key.split('|')[1], count })),
    decades: [...decades.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([name, count]) => ({ name, count })),
  })
})

router.get('/works/:id', (req, res) => {
  const work = workWithStats(Number(req.params.id))
  if (!work) return res.status(404).json({ error: 'Not found' })

  // "More like this" from your own library: shared creator or genre.
  const names = work.creators.filter((c) => c.role !== 'Cast').map((c) => c.name.toLowerCase())
  const genres = work.genres.map((g) => String(g).toLowerCase())
  const pool = all(`${WORK_CARD_SQL} WHERE w.type = ? AND w.id != ? LIMIT 400`, work.type, work.id)
  const related = pool
    .map((row) => {
      const w = hydrate(row)
      let score = 0
      for (const c of w.creators) if (names.includes(String(c.name).toLowerCase())) score += 3
      for (const g of w.genres) if (genres.includes(String(g).toLowerCase())) score += 1
      return { row, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.row.rating ?? 0) - (a.row.rating ?? 0))
    .slice(0, 8)
    .map((x) => cardOf(x.row))

  prioritise([work, ...related])
  res.json({ work, related })
})

router.patch('/works/:id', (req, res) => {
  const id = Number(req.params.id)
  const allowed = ['title', 'year', 'overview', 'poster_url', 'backdrop_url', 'runtime', 'pages', 'type']
  const patch = {}
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k]
  if ('genres' in req.body) patch.genres = JSON.stringify(req.body.genres || [])
  if ('creators' in req.body) patch.creators = JSON.stringify(req.body.creators || [])
  const keys = Object.keys(patch)
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update' })
  run(
    `UPDATE works SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    ...keys.map((k) => patch[k]), id,
  )
  res.json(workWithStats(id))
})

/** "This is the wrong film" — re-match and replace the metadata. */
router.post('/works/:id/refresh', (req, res) => {
  const id = Number(req.params.id)
  const work = get('SELECT id FROM works WHERE id = ?', id)
  if (!work) return res.status(404).json({ error: 'Not found' })
  queueEnrichment([id], { force: true })
  res.json({ ok: true })
})

router.delete('/works/:id', (req, res) => {
  run('DELETE FROM works WHERE id = ?', Number(req.params.id))
  res.json({ ok: true })
})

/** POST /api/log — the quick-log action, from a library work or a provider hit. */
router.post('/log', (req, res) => {
  const { work_id, work, rating, consumed_on, review, notes, tags, status, is_repeat, liked, progress, season } = req.body
  let id = work_id
  if (!id) {
    if (!work?.title || !work?.type) return res.status(400).json({ error: 'work.title and work.type are required' })
    const { work: saved, created } = upsertWork(work)
    id = saved.id
    if (created || !saved.poster_url) queueEnrichment([saved.id])
  }
  const stmt = run(
    `INSERT INTO entries (work_id, status, rating, liked, consumed_on, is_repeat, season, progress, review, notes, tags, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual')`,
    id, status || 'completed', rating ?? null, liked ? 1 : 0,
    consumed_on === undefined ? today() : consumed_on || null,
    is_repeat ? 1 : 0, season ?? null, progress || null, review || null, notes || null,
    JSON.stringify(tags || []),
  )
  // Logging something answers any outstanding recommendation for it.
  const w = get('SELECT type, title FROM works WHERE id = ?', id)
  if (w) {
    for (const rec of all("SELECT id, title, type FROM recs WHERE status = 'open'")) {
      if (rec.type === w.type && normaliseTitle(rec.title) === normaliseTitle(w.title)) {
        run("UPDATE recs SET status = 'done', acted_at = datetime('now'), work_id = ? WHERE id = ?", id, rec.id)
      }
    }
  }
  res.json({ ok: true, entry_id: Number(stmt.lastInsertRowid), work: workWithStats(id) })
})

router.patch('/entries/:id', (req, res) => {
  const id = Number(req.params.id)
  const entry = get('SELECT * FROM entries WHERE id = ?', id)
  if (!entry) return res.status(404).json({ error: 'Not found' })
  const patch = {}
  for (const k of ['rating', 'consumed_on', 'review', 'notes', 'status', 'progress', 'season', 'episode']) {
    if (k in req.body) patch[k] = req.body[k] === '' ? null : req.body[k]
  }
  if ('liked' in req.body) patch.liked = req.body.liked ? 1 : 0
  if ('is_repeat' in req.body) patch.is_repeat = req.body.is_repeat ? 1 : 0
  if ('tags' in req.body) patch.tags = JSON.stringify(req.body.tags || [])
  const keys = Object.keys(patch)
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update' })
  run(
    `UPDATE entries SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    ...keys.map((k) => patch[k]), id,
  )
  res.json(workWithStats(entry.work_id))
})

router.delete('/entries/:id', (req, res) => {
  const entry = get('SELECT * FROM entries WHERE id = ?', Number(req.params.id))
  if (!entry) return res.status(404).json({ error: 'Not found' })
  run('DELETE FROM entries WHERE id = ?', entry.id)
  res.json({ ok: true, work: workWithStats(entry.work_id) })
})

/** The diary: everything you logged, newest first. */
router.get('/activity', (req, res) => {
  const limit = clamp(Number(req.query.limit) || 40, 1, 200)
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const type = req.query.type && req.query.type !== 'all' ? req.query.type : null
  const rows = all(
    `SELECT e.*, w.title, w.type, w.year, w.poster_url, w.creators
       FROM entries e JOIN works w ON w.id = e.work_id
      WHERE (? IS NULL OR w.type = ?)
      ORDER BY ifnull(e.consumed_on, date(e.created_at)) DESC, e.id DESC
      LIMIT ? OFFSET ?`,
    type, type, limit, offset,
  )
  prioritise(rows.map((r) => ({ id: r.work_id, poster_url: r.poster_url })))
  res.json({
    activity: rows.map((r) => ({
      entry_id: r.id,
      work_id: r.work_id,
      title: r.title,
      type: r.type,
      year: r.year,
      poster_url: r.poster_url,
      creators: json(r.creators, []).filter((c) => c.role !== 'Cast').slice(0, 1),
      rating: r.rating,
      liked: Boolean(r.liked),
      consumed_on: r.consumed_on,
      is_repeat: Boolean(r.is_repeat),
      progress: r.progress,
      review: r.review,
      status: r.status,
      source: r.source,
      tags: json(r.tags, []),
    })),
    total: get('SELECT count(*) c FROM entries').c,
  })
})

/** Search: your own library first, then the metadata providers. */
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ local: [], remote: [] })
  const type = req.query.type && req.query.type !== 'all' ? req.query.type : null
  const local = all(
    `${WORK_CARD_SQL} WHERE lower(w.title) LIKE ? ${type ? 'AND w.type = ?' : ''} ORDER BY entry_count DESC, w.sort_title LIMIT 12`,
    `%${q.toLowerCase()}%`, ...(type ? [type] : []),
  ).map(cardOf)

  let remote = []
  if (req.query.remote !== '0') {
    try {
      remote = type
        ? await searchProviders(type, q, 12)
        : await searchAllTypes(q, ['film', 'tv', 'book', 'audiobook', 'album'], 5)
    } catch { remote = [] }
  }

  // Across types the best match must float to the top, whatever media it is.
  const want = normaliseTitle(q)
  const score = (r) => {
    const t = normaliseTitle(r.title)
    let n = t === want ? 100 : t.startsWith(want) ? 70 : t.includes(want) ? 40 : 0
    if (r.poster_url) n += 6
    if (r.year) n += 2
    if (r.popularity) n += Math.min(8, Math.log10(1 + r.popularity) * 3)
    if (r.external_rating) n += Math.min(4, r.external_rating / 3)
    return n
  }

  const known = new Set(local.map((l) => `${l.type}|${normaliseTitle(l.title)}`))
  res.json({
    local,
    remote: remote
      .filter((r) => r && !known.has(`${r.type}|${normaliseTitle(r.title)}`))
      .sort((a, b) => score(b) - score(a))
      .slice(0, 14)
      .map((r) => ({
        type: r.type, title: r.title, year: r.year, poster_url: r.poster_url,
        creators: (r.creators || []).filter((c) => c.role !== 'Cast').slice(0, 2),
        genres: (r.genres || []).slice(0, 3), overview: r.overview, provider: r.provider,
        external_rating: r.external_rating ?? null,
        tmdb_id: r.tmdb_id, imdb_id: r.imdb_id, isbn: r.isbn, olid: r.olid,
        itunes_id: r.itunes_id, mbid: r.mbid, runtime: r.runtime, pages: r.pages,
        metadata: r.metadata,
      })),
  })
})

router.get('/sections', (req, res) => {
  const counts = all(`
    SELECT w.type,
           count(DISTINCT w.id) works,
           count(e.id) entries,
           round(avg(e.rating), 2) avg_rating
      FROM works w LEFT JOIN entries e ON e.work_id = w.id
     GROUP BY w.type`)
  const byType = Object.fromEntries(counts.map((c) => [c.type, c]))
  res.json(TYPES.map((type) => ({
    type,
    ...SECTIONS[type],
    works: byType[type]?.works || 0,
    entries: byType[type]?.entries || 0,
    avg_rating: byType[type]?.avg_rating ?? null,
  })))
})
