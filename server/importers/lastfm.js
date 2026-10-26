import { parseCsvObjects, columnIndex, pick, hasAnyColumn } from '../lib/csv.js'
import { parseDate, normaliseTitle } from '../lib/util.js'
import { record, keyFor } from './shared.js'

export const id = 'lastfm'
export const label = 'Last.fm'
export const accepts = ['.csv', '.json']
export const help = 'Export your scrobbles with lastfm.ghan.nl or benjaminbenben.com/lastfm-to-csv '
  + 'and drop the CSV here. Scrobbles are grouped into albums.'

export const options = [
  { key: 'minPlays', label: 'Only log albums with at least this many scrobbles', type: 'number', default: 3 },
]

export function detect({ filename, headers, jsonSample }) {
  const name = String(filename || '').toLowerCase()
  if (name.includes('lastfm') || name.includes('scrobble')) return { confidence: 0.95, reason: 'Last.fm filename' }
  if (headers && hasAnyColumn(headers, ['artist']) && hasAnyColumn(headers, ['track']) && hasAnyColumn(headers, ['uts', 'utc_time', 'date'])) {
    return { confidence: 0.85, reason: 'scrobble columns (artist/track/date)' }
  }
  if (jsonSample) {
    const first = Array.isArray(jsonSample) ? jsonSample[0] : null
    if (first && first.artist && first.name && first.date) return { confidence: 0.8, reason: 'Last.fm JSON scrobbles' }
  }
  return { confidence: 0 }
}

export function parse(files, opts = {}) {
  const minPlays = Number(opts.minPlays ?? 3)
  const albums = new Map()

  for (const file of files) {
    let rows = []
    if (file.json !== undefined || /\.json$/i.test(file.filename || '')) {
      const data = file.json !== undefined ? file.json : JSON.parse(file.text)
      rows = (Array.isArray(data) ? data : data.scrobbles || []).map((s) => ({
        artist: typeof s.artist === 'object' ? s.artist['#text'] || s.artist.name : s.artist,
        album: typeof s.album === 'object' ? s.album['#text'] : s.album,
        track: s.name || s.track,
        date: typeof s.date === 'object' ? s.date['#text'] : s.date,
      }))
    } else {
      const { headers, rows: csvRows } = parseCsvObjects(file.text)
      const idx = columnIndex(headers)
      // Some exporters ship headerless CSVs: artist,album,track,date
      const headerless = !hasAnyColumn(headers, ['artist', 'track', 'name'])
      if (headerless) {
        const first = parseCsvObjects('artist,album,track,date\n' + file.text)
        rows = first.rows
      } else {
        rows = csvRows.map((r) => ({
          artist: pick(r, ['artist', 'artist name'], idx),
          album: pick(r, ['album', 'album name'], idx),
          track: pick(r, ['track', 'name', 'title', 'track name'], idx),
          date: pick(r, ['utc_time', 'date', 'uts', 'timestamp'], idx),
        }))
      }
    }

    for (const r of rows) {
      if (!r.artist || !r.track) continue
      const albumTitle = r.album || r.track
      const key = `${normaliseTitle(r.artist)}|${normaliseTitle(albumTitle)}`
      const date = /^\d{9,10}$/.test(String(r.date))
        ? new Date(Number(r.date) * 1000).toISOString().slice(0, 10)
        : parseDate(r.date)
      const cur = albums.get(key) || { title: albumTitle, artist: r.artist, plays: 0, tracks: new Set(), last: null }
      cur.plays++
      cur.tracks.add(r.track)
      if (date && (!cur.last || date > cur.last)) cur.last = date
      albums.set(key, cur)
    }
  }

  return [...albums.values()]
    .filter((a) => a.plays >= minPlays)
    .map((a) => record({
      kind: 'entry',
      type: 'album',
      title: a.title,
      creators: [{ role: 'Artist', name: a.artist }],
      consumed_on: a.last,
      progress: `${a.plays} scrobbles`,
      metadata: { play_count: a.plays, distinct_tracks: a.tracks.size, source: 'lastfm' },
      external_key: keyFor('lastfm', 'album', [normaliseTitle(a.artist), normaliseTitle(a.title)]),
    }))
}
