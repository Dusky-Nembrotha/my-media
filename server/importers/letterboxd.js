import { parseCsvObjects, columnIndex, pick, hasAnyColumn } from '../lib/csv.js'
import { parseDate, parseRating, parseYear, splitPeople, normaliseTitle } from '../lib/util.js'
import { record, keyFor } from './shared.js'

export const id = 'letterboxd'
export const label = 'Letterboxd'
export const accepts = ['.csv', '.zip']
export const help = 'Letterboxd → Settings → Data → Export your data. Drop the whole ZIP in; '
  + 'diary, ratings, watched, watchlist, likes, reviews and your lists are all read.'

const FILE_ROLES = [
  [/diary\.csv$/i, 'diary'],
  [/reviews\.csv$/i, 'reviews'],
  [/ratings\.csv$/i, 'ratings'],
  [/watched\.csv$/i, 'watched'],
  [/watchlist\.csv$/i, 'watchlist'],
  [/likes\/films\.csv$/i, 'likes'],
  [/lists\/.+\.csv$/i, 'list'],
  [/films\.csv$/i, 'watched'],
]

export function roleForFilename(name) {
  for (const [re, role] of FILE_ROLES) if (re.test(name)) return role
  return null
}

export function detect({ filename, text, headers }) {
  const name = String(filename || '').toLowerCase()
  if (name.includes('letterboxd')) return { confidence: 0.95, reason: 'Letterboxd export filename' }
  if (headers && hasAnyColumn(headers, ['letterboxd uri'])) {
    return { confidence: 0.95, reason: 'Letterboxd URI column' }
  }
  if (headers && hasAnyColumn(headers, ['watched date']) && hasAnyColumn(headers, ['name'])) {
    return { confidence: 0.7, reason: 'diary-style columns (Name + Watched Date)' }
  }
  void text
  return { confidence: 0 }
}

function uriSlug(uri) {
  const m = String(uri || '').match(/boxd\.it\/(\w+)/)
  if (m) return m[1]
  const m2 = String(uri || '').match(/letterboxd\.com\/film\/([^/]+)/)
  return m2 ? m2[1] : null
}

/** Parse one CSV from a Letterboxd export. `role` decides what it means. */
export function parseFile({ filename, text }) {
  const { headers, rows } = parseCsvObjects(text)
  if (!rows.length) return []
  const idx = columnIndex(headers)
  const role = roleForFilename(filename || '') || (idx.has('watcheddate') ? 'diary' : idx.has('rating') ? 'ratings' : 'watched')
  const listName = role === 'list'
    ? String(filename).split('/').pop().replace(/\.csv$/i, '').replace(/-/g, ' ')
    : null

  const out = []
  for (const row of rows) {
    const title = pick(row, ['Name', 'Title', 'Film'], idx)
    if (!title) continue
    const year = parseYear(pick(row, ['Year'], idx))
    const uri = pick(row, ['Letterboxd URI', 'URI', 'url'], idx)
    const slug = uriSlug(uri)
    const rating = parseRating(pick(row, ['Rating'], idx)) ?? parseRating(pick(row, ['Rating10'], idx), 10)
    const watchedDate = parseDate(pick(row, ['Watched Date', 'WatchedDate'], idx))
    const loggedDate = parseDate(pick(row, ['Date'], idx))
    const review = pick(row, ['Review'], idx) || null
    const tags = pick(row, ['Tags'], idx).split(',').map((t) => t.trim()).filter(Boolean)
    const rewatch = /yes|true|1/i.test(pick(row, ['Rewatch'], idx))
    const base = {
      type: 'film',
      title,
      year,
      creators: splitPeople(pick(row, ['Directors', 'Director'], idx)).map((name) => ({ role: 'Director', name })),
      tmdb_id: pick(row, ['tmdbID', 'TMDb ID'], idx) || null,
      imdb_id: pick(row, ['imdbID', 'IMDb ID'], idx) || null,
      metadata: { letterboxd_uri: uri || null, letterboxd_slug: slug },
    }

    if (role === 'watchlist') {
      out.push(record({
        ...base,
        kind: 'rec',
        recommender: 'Letterboxd watchlist',
        source_url: uri || null,
        external_key: keyFor('letterboxd', 'watchlist', [slug || normaliseTitle(title)]),
      }))
      continue
    }
    if (role === 'list') {
      out.push(record({
        ...base,
        kind: 'list',
        listName: listName || 'Letterboxd list',
        note: pick(row, ['Notes', 'Description'], idx) || null,
        position: Number(pick(row, ['Position'], idx)) || 0,
        external_key: keyFor('letterboxd', 'list', [listName, slug || normaliseTitle(title)]),
      }))
      continue
    }
    if (role === 'likes') {
      out.push(record({
        ...base,
        kind: 'entry',
        liked: true,
        merge: true,
        consumed_on: null,
        external_key: keyFor('letterboxd', 'like', [slug || normaliseTitle(title)]),
      }))
      continue
    }

    const date = watchedDate || loggedDate
    const isDiaryShaped = role === 'diary' || role === 'reviews'
    out.push(record({
      ...base,
      kind: 'entry',
      rating,
      review,
      tags,
      is_repeat: rewatch,
      consumed_on: date,
      // watched.csv / ratings.csv are summaries of the same viewings the diary
      // already describes, so they merge into an existing entry if there is one.
      merge: !isDiaryShaped,
      external_key: isDiaryShaped
        ? keyFor('letterboxd', 'diary', [slug || normaliseTitle(title), date || ''])
        : keyFor('letterboxd', role, [slug || normaliseTitle(title)]),
    }))
  }
  return out
}

export function parse(files) {
  // Richest files first: diary and reviews create the entries, then the
  // summary files (ratings, watched, likes) merge into what already exists.
  const order = { diary: 0, reviews: 1, ratings: 2, watched: 3, likes: 4, watchlist: 5, list: 6 }
  const sorted = [...files].sort(
    (a, b) => (order[roleForFilename(a.filename) ?? ''] ?? 9) - (order[roleForFilename(b.filename) ?? ''] ?? 9),
  )
  return sorted.flatMap((f) => parseFile(f))
}
