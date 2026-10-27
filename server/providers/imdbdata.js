/*
 * IMDb's ratings, read from the local copy of their published dataset.
 *
 * OMDb answers one title at a time and allows a thousand a day; a single
 * chart page used to spend eighteen of them, and paging through Hot a few
 * times spent the lot. The same numbers come straight from IMDb as a bulk
 * download, so the question can be asked six hundred thousand times a second
 * instead, offline, with nothing to run out of.
 *
 * Built by scripts/fetch-imdb-ratings.js. Absent until that is run, in which
 * case every lookup politely returns nothing and OMDb carries on as before.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../lib/db.js'
import { normaliseTitle } from '../lib/util.js'

let db
let opened = false

function open() {
  if (opened) return db
  opened = true
  const path = join(DATA_DIR, 'imdb.db')
  if (!existsSync(path)) return (db = null)
  try {
    db = new DatabaseSync(path, { readOnly: true })
  } catch {
    db = null
  }
  return db
}

export function hasDataset() {
  return Boolean(open())
}

/** Which of IMDb's title types count as which of ours. */
const KINDS = {
  film: ['movie', 'tvMovie', 'video'],
  tv: ['tvSeries', 'tvMiniSeries', 'tvSpecial'],
  game: ['videoGame'],
}

const asScore = (row) => (row
  ? {
      rating: row.rating,
      votes: row.votes,
      url: `https://www.imdb.com/title/${row.tconst}/`,
    }
  : null)

/**
 * What IMDb's voters made of something.
 *
 * An id is exact. A name is not, so the year narrows it, then a year either
 * side for the many titles filed under their release rather than their
 * production year — and failing that the most-voted title of that name, which
 * is all but always the one being asked about.
 */
export function score({ imdbId, title, year, type }) {
  const d = open()
  if (!d) return null

  if (imdbId) {
    const row = d.prepare('SELECT tconst, rating, votes FROM imdb WHERE tconst = ?').get(String(imdbId))
    if (row) return asScore(row)
  }

  const norm = normaliseTitle(title || '')
  if (!norm) return null

  const kinds = KINDS[type] || null
  const typeClause = kinds ? ` AND type IN (${kinds.map(() => '?').join(', ')})` : ''
  const typeArgs = kinds || []

  if (year) {
    const exact = d
      .prepare(`SELECT tconst, rating, votes FROM imdb WHERE norm = ?${typeClause} AND year = ? ORDER BY votes DESC LIMIT 1`)
      .get(norm, ...typeArgs, Number(year))
    if (exact) return asScore(exact)

    const near = d
      .prepare(`SELECT tconst, rating, votes FROM imdb WHERE norm = ?${typeClause} AND year BETWEEN ? AND ? ORDER BY votes DESC LIMIT 1`)
      .get(norm, ...typeArgs, Number(year) - 1, Number(year) + 1)
    /*
     * And no further. Knowing the year and ignoring it would put the 1997
     * mini-series' score on the 2026 film — there are five things called The
     * Odyssey. No badge is better than the wrong one.
     */
    return asScore(near)
  }

  const best = d
    .prepare(`SELECT tconst, rating, votes FROM imdb WHERE norm = ?${typeClause} ORDER BY votes DESC LIMIT 1`)
    .get(norm, ...typeArgs)
  return asScore(best)
}

/** When the copy was built, so the app can say how old its numbers are. */
export function builtAt() {
  const path = join(DATA_DIR, 'imdb.db')
  if (!existsSync(path)) return null
  try {
    return require('node:fs').statSync(path).mtime.toISOString()
  } catch {
    return null
  }
}
