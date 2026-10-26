import { fetchJson } from '../lib/http.js'
import { parseYear } from '../lib/util.js'

// Keyless (rate-limited to ~1 req/sec, which lib/http.js enforces).
const BASE = 'https://musicbrainz.org/ws/2'

export function coverUrl(mbid, size = 500) {
  return mbid ? `https://coverartarchive.org/release-group/${mbid}/front-${size}` : null
}

function normalise(rg) {
  if (!rg || !rg.title) return null
  const artists = (rg['artist-credit'] || []).map((a) => a.name || a.artist?.name).filter(Boolean)
  return {
    provider: 'musicbrainz',
    type: 'album',
    title: rg.title,
    year: parseYear(rg['first-release-date']),
    release_date: rg['first-release-date'] || null,
    creators: artists.map((name) => ({ role: 'Artist', name })),
    genres: (rg.tags || []).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 8).map((t) => t.name),
    poster_url: coverUrl(rg.id, 500),
    backdrop_url: coverUrl(rg.id, 1200),
    mbid: rg.id,
    popularity: rg.score || null,
    metadata: {
      primary_type: rg['primary-type'],
      artist_ids: (rg['artist-credit'] || []).map((a) => a.artist?.id).filter(Boolean),
    },
  }
}

export async function searchAlbums(term, limit = 10) {
  if (!term) return []
  try {
    const data = await fetchJson(
      `${BASE}/release-group?query=${encodeURIComponent(term)}&fmt=json&limit=${limit}&inc=tags`,
      { ttlSeconds: 60 * 60 * 24 * 30 },
    )
    return (data['release-groups'] || [])
      .filter((rg) => ['Album', 'EP', undefined].includes(rg['primary-type']))
      .map(normalise)
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function byArtistMbid(artistMbid, limit = 25) {
  if (!artistMbid) return []
  try {
    const data = await fetchJson(
      `${BASE}/release-group?artist=${artistMbid}&type=album|ep&fmt=json&limit=${limit}`,
      { ttlSeconds: 60 * 60 * 24 * 14 },
    )
    return (data['release-groups'] || []).map(normalise).filter(Boolean)
  } catch {
    return []
  }
}

/** Albums tagged with a genre — keyless music candidate generation. */
export async function byTag(tag, limit = 25) {
  if (!tag) return []
  try {
    const data = await fetchJson(
      `${BASE}/release-group?query=tag:"${encodeURIComponent(tag)}"%20AND%20primarytype:album&fmt=json&limit=${limit}`,
      { ttlSeconds: 60 * 60 * 24 * 14 },
    )
    return (data['release-groups'] || []).map(normalise).filter(Boolean)
  } catch {
    return []
  }
}
