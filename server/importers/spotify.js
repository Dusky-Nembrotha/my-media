import { parseDate, normaliseTitle } from '../lib/util.js'
import { record, keyFor } from './shared.js'

export const id = 'spotify'
export const label = 'Spotify'
export const accepts = ['.json', '.zip']
export const help = 'Spotify → Privacy Settings → Download your data. Drop in the whole ZIP, or the '
  + 'Streaming_History_Audio_*.json / StreamingHistory*.json / YourLibrary.json files. '
  + 'Plays are grouped into albums and podcast shows rather than thousands of single tracks.'

export const options = [
  { key: 'minPlays', label: 'Only log albums with at least this many track plays', type: 'number', default: 3 },
  { key: 'includeTracks', label: 'Also log individual stand-out tracks (10+ plays)', type: 'boolean', default: false },
  { key: 'includePodcasts', label: 'Log podcast shows too', type: 'boolean', default: true },
]

export function detect({ filename, jsonSample }) {
  const name = String(filename || '').toLowerCase()
  if (/streaming_history|streaminghistory|yourlibrary|marquee|playlist\d*\.json/.test(name)) {
    return { confidence: 0.96, reason: 'Spotify data-download filename' }
  }
  if (jsonSample) {
    const first = Array.isArray(jsonSample) ? jsonSample[0] : jsonSample
    if (first && ('master_metadata_track_name' in first || 'ms_played' in first)) {
      return { confidence: 0.97, reason: 'Spotify extended streaming history fields' }
    }
    if (first && 'trackName' in first && 'msPlayed' in first) {
      return { confidence: 0.95, reason: 'Spotify streaming history fields' }
    }
    if (first && (first.tracks || first.albums) && !Array.isArray(first)) {
      return { confidence: 0.75, reason: 'Spotify library shape' }
    }
  }
  if (name.includes('spotify')) return { confidence: 0.7, reason: 'Spotify filename' }
  return { confidence: 0 }
}

function addPlay(map, key, fields) {
  const cur = map.get(key) || { ...fields, plays: 0, ms: 0, first: null, last: null, tracks: new Set() }
  cur.plays++
  cur.ms += fields.ms || 0
  if (fields.track) cur.tracks.add(fields.track)
  if (fields.date) {
    if (!cur.first || fields.date < cur.first) cur.first = fields.date
    if (!cur.last || fields.date > cur.last) cur.last = fields.date
  }
  map.set(key, cur)
}

export function parse(files, opts = {}) {
  const minPlays = Number(opts.minPlays ?? 3)
  const includeTracks = Boolean(opts.includeTracks)
  const includePodcasts = opts.includePodcasts !== false

  const albums = new Map()
  const shows = new Map()
  const tracks = new Map()
  const out = []

  for (const file of files) {
    let data = file.json
    if (data === undefined) {
      try { data = JSON.parse(file.text) } catch { continue }
    }

    // Saved library / playlists -> recommendations rather than history.
    if (!Array.isArray(data)) {
      for (const album of data.albums || []) {
        if (!album.album && !album.name) continue
        out.push(record({
          kind: 'rec',
          type: 'album',
          title: album.album || album.name,
          creators: album.artist ? [{ role: 'Artist', name: album.artist }] : [],
          recommender: 'Saved on Spotify',
          spotify_id: (album.uri || '').split(':').pop() || null,
          external_key: keyFor('spotify', 'saved-album', [normaliseTitle(album.album || album.name)]),
        }))
      }
      for (const show of data.shows || []) {
        if (!includePodcasts || !show.name) continue
        out.push(record({
          kind: 'rec',
          type: 'podcast',
          title: show.name,
          creators: show.publisher ? [{ role: 'Publisher', name: show.publisher }] : [],
          recommender: 'Followed on Spotify',
          external_key: keyFor('spotify', 'saved-show', [normaliseTitle(show.name)]),
        }))
      }
      for (const playlist of data.playlists || []) {
        for (const item of playlist.items || []) {
          const t = item.track
          if (!t?.trackName) continue
          out.push(record({
            kind: 'list',
            type: 'track',
            listName: `Spotify · ${playlist.name}`,
            title: t.trackName,
            creators: t.artistName ? [{ role: 'Artist', name: t.artistName }] : [],
            external_key: keyFor('spotify', 'playlist', [playlist.name, normaliseTitle(t.trackName)]),
          }))
        }
      }
      continue
    }

    for (const row of data) {
      const ms = row.ms_played ?? row.msPlayed ?? 0
      const date = parseDate(row.ts || row.endTime || row.end_time)
      const trackName = row.master_metadata_track_name ?? row.trackName ?? null
      const artist = row.master_metadata_album_artist_name ?? row.artistName ?? null
      const album = row.master_metadata_album_album_name ?? row.albumName ?? null
      const episode = row.episode_name ?? null
      const showName = row.episode_show_name ?? null

      if (episode && showName) {
        if (includePodcasts && ms > 60000) {
          addPlay(shows, normaliseTitle(showName), { title: showName, ms, date, track: episode, type: 'podcast' })
        }
        continue
      }
      if (!trackName || !artist) continue           // skipped/unknown rows
      if (ms < 30000) continue                       // under 30s is not a listen

      const albumTitle = album || trackName
      addPlay(albums, `${normaliseTitle(artist)}|${normaliseTitle(albumTitle)}`, {
        title: albumTitle, artist, ms, date, track: trackName, type: 'album',
        spotify_id: (row.spotify_track_uri || '').split(':').pop() || null,
      })
      if (includeTracks) {
        addPlay(tracks, `${normaliseTitle(artist)}|${normaliseTitle(trackName)}`, {
          title: trackName, artist, ms, date, type: 'track',
          spotify_id: (row.spotify_track_uri || '').split(':').pop() || null,
        })
      }
    }
  }

  for (const agg of albums.values()) {
    if (agg.plays < minPlays) continue
    out.push(record({
      kind: 'entry',
      type: 'album',
      title: agg.title,
      creators: [{ role: 'Artist', name: agg.artist }],
      consumed_on: agg.last,
      progress: `${agg.plays} plays · ${Math.round(agg.ms / 60000)} min`,
      status: 'completed',
      is_repeat: agg.plays > agg.tracks.size * 1.5,
      metadata: {
        play_count: agg.plays,
        ms_played: agg.ms,
        distinct_tracks: agg.tracks.size,
        first_played: agg.first,
        source: 'spotify',
      },
      external_key: keyFor('spotify', 'album', [normaliseTitle(agg.artist), normaliseTitle(agg.title)]),
    }))
  }

  for (const agg of tracks.values()) {
    if (agg.plays < 10) continue
    out.push(record({
      kind: 'entry',
      type: 'track',
      title: agg.title,
      creators: [{ role: 'Artist', name: agg.artist }],
      consumed_on: agg.last,
      progress: `${agg.plays} plays`,
      metadata: { play_count: agg.plays, ms_played: agg.ms, source: 'spotify' },
      external_key: keyFor('spotify', 'track', [normaliseTitle(agg.artist), normaliseTitle(agg.title)]),
    }))
  }

  for (const agg of shows.values()) {
    out.push(record({
      kind: 'entry',
      type: 'podcast',
      title: agg.title,
      consumed_on: agg.last,
      progress: `${agg.tracks.size} episodes · ${Math.round(agg.ms / 3600000)} h`,
      metadata: { episodes_played: agg.tracks.size, ms_played: agg.ms, source: 'spotify' },
      external_key: keyFor('spotify', 'podcast', [normaliseTitle(agg.title)]),
    }))
  }

  return out
}
