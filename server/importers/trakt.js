import { parseCsvObjects, columnIndex, pick, hasAnyColumn } from '../lib/csv.js'
import { parseDate, parseRating, parseYear, normaliseTitle } from '../lib/util.js'
import { record, keyFor, rollUpEpisodes } from './shared.js'

export const id = 'trakt'
export const label = 'Trakt'
export const accepts = ['.csv', '.json']
export const help = 'Trakt VIP → Settings → Export, or any trakt-exporter JSON/CSV '
  + '(watched_movies, watched_shows, ratings, watchlist). Episodes are rolled up per season.'

export function detect({ filename, headers, jsonSample }) {
  const name = String(filename || '').toLowerCase()
  if (name.includes('trakt')) return { confidence: 0.95, reason: 'Trakt filename' }
  if (jsonSample) {
    const first = Array.isArray(jsonSample) ? jsonSample[0] : jsonSample
    if (first && (first.movie || first.show) && (first.watched_at || first.rated_at || first.plays || first.listed_at)) {
      return { confidence: 0.95, reason: 'Trakt JSON shape (movie/show + watched_at)' }
    }
  }
  if (headers && hasAnyColumn(headers, ['trakt id', 'trakt_id'])) {
    return { confidence: 0.9, reason: 'Trakt ID column' }
  }
  if (headers && hasAnyColumn(headers, ['watched_at', 'watched at'])) {
    return { confidence: 0.6, reason: 'watched_at column' }
  }
  return { confidence: 0 }
}

function fromTraktItem(item, kind) {
  const show = item.show
  const movie = item.movie
  const episode = item.episode
  const season = item.season

  if (movie) {
    return {
      type: 'film',
      title: movie.title,
      year: movie.year || null,
      imdb_id: movie.ids?.imdb || null,
      tmdb_id: movie.ids?.tmdb ? String(movie.ids.tmdb) : null,
      metadata: { trakt_id: movie.ids?.trakt, trakt_slug: movie.ids?.slug },
      kind,
    }
  }
  if (show) {
    return {
      type: 'tv',
      title: show.title,
      year: show.year || null,
      imdb_id: show.ids?.imdb || null,
      tmdb_id: show.ids?.tmdb ? String(show.ids.tmdb) : null,
      season: episode?.season ?? season?.number ?? null,
      episode: episode?.number ?? null,
      metadata: { trakt_id: show.ids?.trakt, trakt_slug: show.ids?.slug },
      kind,
    }
  }
  return null
}

function parseJson(data, filename) {
  const rows = Array.isArray(data) ? data : data.movies || data.shows || data.items || []
  const isWatchlist = /watchlist/i.test(filename || '')
  const entries = []
  const episodeRows = []
  const out = []

  for (const item of rows) {
    const base = fromTraktItem(item, isWatchlist ? 'rec' : 'entry')
    if (!base || !base.title) continue
    const rating = parseRating(item.rating, 10)
    const date = parseDate(item.watched_at || item.last_watched_at || item.rated_at || item.listed_at)

    if (isWatchlist) {
      out.push(record({
        ...base,
        kind: 'rec',
        recommender: 'Trakt watchlist',
        external_key: keyFor('trakt', 'watchlist', [base.type, normaliseTitle(base.title)]),
      }))
      continue
    }

    // Trakt nests seasons/episodes inside watched shows.
    if (base.type === 'tv' && Array.isArray(item.seasons)) {
      for (const s of item.seasons) {
        for (const ep of s.episodes || []) {
          episodeRows.push({
            ...base,
            season: s.number,
            episode: ep.number,
            rating,
            consumed_on: parseDate(ep.last_watched_at) || date,
          })
        }
      }
      if (!item.seasons.length) {
        entries.push(record({ ...base, rating, consumed_on: date, external_key: keyFor('trakt', 'show', [normaliseTitle(base.title)]) }))
      }
      continue
    }
    if (base.type === 'tv' && base.season != null) {
      episodeRows.push({ ...base, rating, consumed_on: date })
      continue
    }

    entries.push(record({
      ...base,
      rating,
      consumed_on: date,
      is_repeat: (item.plays || 1) > 1,
      progress: (item.plays || 1) > 1 ? `Watched ${item.plays}×` : null,
      external_key: keyFor('trakt', base.type, [normaliseTitle(base.title), date || '']),
    }))
  }

  return [...entries, ...rollUpEpisodes(episodeRows, { source: 'trakt' }), ...out]
}

function parseCsvFile(file) {
  const { headers, rows } = parseCsvObjects(file.text)
  const idx = columnIndex(headers)
  const isWatchlist = /watchlist/i.test(file.filename || '')
  const episodeRows = []
  const out = []

  for (const row of rows) {
    const title = pick(row, ['title', 'show title', 'movie title', 'name'], idx)
    if (!title) continue
    const season = Number(pick(row, ['season', 'season number'], idx)) || null
    const episodeNo = Number(pick(row, ['episode', 'episode number'], idx)) || null
    const kindCol = pick(row, ['type', 'media type'], idx).toLowerCase()
    const type = /show|episode|season|tv/.test(kindCol) || season ? 'tv' : 'film'
    const base = {
      type,
      title,
      year: parseYear(pick(row, ['year', 'released'], idx)),
      imdb_id: pick(row, ['imdb id', 'imdb_id', 'imdb'], idx) || null,
      tmdb_id: pick(row, ['tmdb id', 'tmdb_id', 'tmdb'], idx) || null,
      metadata: { trakt_id: pick(row, ['trakt id', 'trakt_id'], idx) || null },
    }
    const rating = parseRating(pick(row, ['rating', 'your rating'], idx), 10)
    const date = parseDate(pick(row, ['watched at', 'watched_at', 'last watched at', 'rated at', 'listed at'], idx))

    if (isWatchlist) {
      out.push(record({ ...base, kind: 'rec', recommender: 'Trakt watchlist', external_key: keyFor('trakt', 'watchlist', [type, normaliseTitle(title)]) }))
      continue
    }
    if (type === 'tv' && (season || episodeNo)) {
      episodeRows.push({ ...base, season, episode: episodeNo, rating, consumed_on: date })
      continue
    }
    out.push(record({
      ...base,
      rating,
      consumed_on: date,
      external_key: keyFor('trakt', type, [normaliseTitle(title), date || '']),
    }))
  }
  return [...out, ...rollUpEpisodes(episodeRows, { source: 'trakt' })]
}

export function parse(files) {
  return files.flatMap((file) => {
    if (file.json !== undefined) return parseJson(file.json, file.filename)
    if (/\.json$/i.test(file.filename || '')) {
      try { return parseJson(JSON.parse(file.text), file.filename) } catch { return [] }
    }
    return parseCsvFile(file)
  })
}
