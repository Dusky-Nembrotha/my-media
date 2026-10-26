import { parseCsvObjects, columnIndex, pick, hasAnyColumn } from '../lib/csv.js'
import { parseDate, parseRating, parseYear, splitPeople, normaliseTitle } from '../lib/util.js'
import { record, keyFor } from './shared.js'

export const id = 'imdb'
export const label = 'IMDb'
export const accepts = ['.csv']
export const help = 'IMDb → Your Ratings → Export, or any IMDb list export. '
  + 'Ratings land as logged entries (converted from /10 to stars); Watchlist lands in recommendations.'

const TV_TYPES = /tvseries|tvminiseries|tvspecial|tvmovie$|tv episode|tvepisode/i

export function detect({ filename, headers }) {
  const name = String(filename || '').toLowerCase()
  if (headers && hasAnyColumn(headers, ['const']) && hasAnyColumn(headers, ['title type'])) {
    return { confidence: 0.96, reason: 'IMDb Const + Title Type columns' }
  }
  if (name.includes('imdb')) return { confidence: 0.8, reason: 'IMDb filename' }
  if (headers && hasAnyColumn(headers, ['your rating']) && hasAnyColumn(headers, ['imdb rating'])) {
    return { confidence: 0.9, reason: 'Your Rating + IMDb Rating columns' }
  }
  return { confidence: 0 }
}

export function parse(files) {
  const out = []
  for (const file of files) {
    const { headers, rows } = parseCsvObjects(file.text)
    const idx = columnIndex(headers)
    const isWatchlist = /watchlist/i.test(file.filename || '') || !hasAnyColumn(headers, ['your rating'])
    const listName = /list/i.test(file.filename || '') && !isWatchlist
      ? String(file.filename).replace(/\.csv$/i, '').replace(/[-_]/g, ' ')
      : null

    for (const row of rows) {
      const title = pick(row, ['Title', 'Original Title', 'Primary Title'], idx)
      if (!title) continue
      const titleType = pick(row, ['Title Type'], idx)
      const imdbId = pick(row, ['Const', 'IMDb ID', 'tconst'], idx) || null
      const type = TV_TYPES.test(titleType) && !/tvmovie/i.test(titleType) ? 'tv' : 'film'
      const base = {
        type,
        title,
        year: parseYear(pick(row, ['Year', 'Release Date'], idx)),
        creators: splitPeople(pick(row, ['Directors', 'Director'], idx)).map((name) => ({ role: 'Director', name })),
        imdb_id: imdbId,
        runtime: Number(pick(row, ['Runtime (mins)', 'Runtime'], idx)) || null,
        genres: pick(row, ['Genres'], idx).split(',').map((s) => s.trim()).filter(Boolean),
        external_rating: Number(pick(row, ['IMDb Rating'], idx)) || null,
        popularity: Number(pick(row, ['Num Votes'], idx)) || null,
        metadata: { imdb_url: pick(row, ['URL'], idx) || (imdbId ? `https://www.imdb.com/title/${imdbId}/` : null), title_type: titleType || null },
      }

      const yourRating = pick(row, ['Your Rating'], idx)
      if (isWatchlist && !yourRating) {
        out.push(record({
          ...base,
          kind: listName ? 'list' : 'rec',
          listName,
          recommender: 'IMDb watchlist',
          source_url: base.metadata.imdb_url,
          external_key: keyFor('imdb', listName ? 'list' : 'watchlist', [listName, imdbId || normaliseTitle(title)]),
        }))
        continue
      }

      out.push(record({
        ...base,
        kind: 'entry',
        rating: parseRating(yourRating, 10),
        consumed_on: parseDate(pick(row, ['Date Rated'], idx)),
        merge: true,
        external_key: keyFor('imdb', 'rating', [imdbId || normaliseTitle(title)]),
      }))
    }
  }
  return out
}
