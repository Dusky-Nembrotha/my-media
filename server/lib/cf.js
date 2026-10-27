import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './db.js'

/*
 * The collaborative-filtering model: which films are rated similarly to yours
 * by the 200,000 people in the MovieLens data.
 *
 * It lives in its own file so a rebuild never touches your library, and so the
 * app works perfectly well without it — everything here degrades to "no
 * opinion" when the model has not been built.
 *
 * Built by scripts/build-cf-model.js.
 */
const PATH = join(DATA_DIR, 'cf.db')
let db = null
let checked = false

function open() {
  if (checked) return db
  checked = true
  if (!existsSync(PATH)) return null
  try {
    db = new DatabaseSync(PATH, { readOnly: true })
  } catch {
    db = null
  }
  return db
}

export function available() {
  return Boolean(open())
}

export function info() {
  const handle = open()
  if (!handle) return null
  try {
    const meta = {}
    for (const row of handle.prepare('SELECT key, value FROM cf_meta').all()) meta[row.key] = row.value
    return meta
  } catch {
    return null
  }
}

/**
 * Score every film the crowd associates with the ones you rated.
 *
 * `rated` is [{ tmdb_id, rating }] and `mean` your own average, so a film you
 * marked below your average pushes its neighbours *down*. The score is the
 * similarity-weighted average of those deviations, which keeps it on the same
 * scale as a rating difference however many neighbours contributed.
 *
 * Returns a Map of tmdbId -> { score, weight, from: [{ tmdb_id, sim, rating }] }.
 */
export function scoreNeighbours(rated, mean, { limit = 4000 } = {}) {
  const handle = open()
  const out = new Map()
  if (!handle || !rated?.length) return out

  const byId = new Map()
  for (const r of rated) {
    const id = Number(r.tmdb_id)
    if (id && r.rating != null) byId.set(id, Number(r.rating))
  }
  if (!byId.size) return out

  const ids = [...byId.keys()]
  // Chunked so the IN clause stays a sensible size.
  for (let i = 0; i < ids.length; i += 400) {
    const slice = ids.slice(i, i + 400)
    const rows = handle
      .prepare(`SELECT tmdb_id, other_tmdb, sim FROM cf_neighbour WHERE tmdb_id IN (${slice.map(() => '?').join(',')})`)
      .all(...slice)

    for (const row of rows) {
      const seedRating = byId.get(row.tmdb_id)
      if (seedRating == null) continue
      const other = Number(row.other_tmdb)
      if (byId.has(other)) continue          // you have already rated it

      const slot = out.get(other) || { sum: 0, weight: 0, from: [] }
      slot.sum += row.sim * (seedRating - mean)
      slot.weight += row.sim
      if (slot.from.length < 24) slot.from.push({ tmdb_id: row.tmdb_id, sim: row.sim, rating: seedRating })
      out.set(other, slot)
    }
  }

  for (const [id, slot] of out) {
    /*
     * Shrink by how much evidence there is. One neighbour with a similarity of
     * 0.3 says far less than eight of them agreeing, and without this a film
     * linked to a single five-star favourite would outrank one the crowd
     * connects to a dozen of them.
     */
    const confidence = slot.weight / (slot.weight + 0.6)
    slot.score = (slot.sum / slot.weight) * confidence
    slot.from.sort((a, b) => b.sim - a.sim)
    out.set(id, slot)
  }

  if (out.size <= limit) return out
  return new Map([...out.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit))
}
