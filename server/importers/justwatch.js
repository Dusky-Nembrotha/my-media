import { parseCsvObjects, columnIndex, pick, hasAnyColumn } from '../lib/csv.js'
import { parseDate, parseRating, parseYear, normaliseTitle } from '../lib/util.js'
import { record, keyFor } from './shared.js'

export const id = 'justwatch'
export const label = 'JustWatch'
export const accepts = ['.csv', '.json']
export const help = 'JustWatch → Profile → Settings → Export your data. Your Watchlist becomes '
  + 'recommendations, your Seen list becomes logged entries, and JustWatch ratings are kept.'

export function detect({ filename, headers }) {
  const name = String(filename || '').toLowerCase()
  if (name.includes('justwatch')) return { confidence: 0.95, reason: 'JustWatch filename' }
  if (headers && hasAnyColumn(headers, ['justwatch id', 'jw id'])) {
    return { confidence: 0.9, reason: 'JustWatch ID column' }
  }
  if (headers && hasAnyColumn(headers, ['watchlist', 'seenlist', 'seen list', 'list name']) && hasAnyColumn(headers, ['title'])) {
    return { confidence: 0.6, reason: 'JustWatch-style list column' }
  }
  return { confidence: 0 }
}

export function parse(files) {
  const out = []
  for (const file of files) {
    const { headers, rows } = parseCsvObjects(file.text)
    const idx = columnIndex(headers)
    const fileIsWatchlist = /watchlist/i.test(file.filename || '')
    const fileIsSeen = /seen/i.test(file.filename || '')

    for (const row of rows) {
      const title = pick(row, ['Title', 'Name'], idx)
      if (!title) continue
      const kindCol = pick(row, ['Type', 'Object Type', 'object_type'], idx).toLowerCase()
      const listCol = pick(row, ['List', 'List Name', 'Collection'], idx).toLowerCase()
      const type = /show|series|tv/.test(kindCol) ? 'tv' : 'film'
      const base = {
        type,
        title,
        year: parseYear(pick(row, ['Year', 'Release Year', 'release_year'], idx)),
        imdb_id: pick(row, ['IMDb ID', 'imdb_id'], idx) || null,
        tmdb_id: pick(row, ['TMDB ID', 'tmdb_id'], idx) || null,
        season: Number(pick(row, ['Season', 'Season Number'], idx)) || null,
        metadata: {
          justwatch_id: pick(row, ['JustWatch ID', 'Node ID', 'id'], idx) || null,
          providers: pick(row, ['Streaming Service', 'Provider', 'Offers'], idx) || null,
          justwatch_url: pick(row, ['URL', 'Permalink'], idx) || null,
        },
      }
      const rating = parseRating(pick(row, ['Rating', 'My Rating'], idx), 10)
      const date = parseDate(pick(row, ['Date', 'Seen Date', 'Watchlist Date', 'Added'], idx))
      const isWatchlist = fileIsWatchlist || /watchlist|want to watch/.test(listCol)
      const isSeen = fileIsSeen || /seen|watched/.test(listCol) || rating != null

      if (isWatchlist && !isSeen) {
        out.push(record({
          ...base,
          kind: 'rec',
          recommender: 'JustWatch watchlist',
          source_url: base.metadata.justwatch_url,
          note: base.metadata.providers ? `Streaming on ${base.metadata.providers}` : null,
          external_key: keyFor('justwatch', 'watchlist', [type, normaliseTitle(title)]),
        }))
        continue
      }
      out.push(record({
        ...base,
        kind: 'entry',
        rating,
        consumed_on: date,
        progress: base.season ? `Season ${base.season}` : null,
        external_key: keyFor('justwatch', 'seen', [type, normaliseTitle(title), base.season ?? '']),
      }))
    }
  }
  return out
}
