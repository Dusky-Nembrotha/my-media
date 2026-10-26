import { fetchJson } from '../lib/http.js'
import { parseYear } from '../lib/util.js'

// Keyless, no rate limit worth worrying about, strong TV coverage + artwork.
const BASE = 'https://api.tvmaze.com'

function normalise(show) {
  if (!show || !show.name) return null
  const img = show.image?.original || show.image?.medium || null
  return {
    provider: 'tvmaze',
    type: 'tv',
    title: show.name,
    year: parseYear(show.premiered),
    release_date: show.premiered || null,
    creators: [
      ...(show.network?.name ? [{ role: 'Network', name: show.network.name }] : []),
      ...(show.webChannel?.name ? [{ role: 'Network', name: show.webChannel.name }] : []),
    ],
    genres: show.genres || [],
    overview: show.summary ? show.summary.replace(/<[^>]+>/g, '').trim() : null,
    runtime: show.averageRuntime || show.runtime || null,
    language: show.language || null,
    poster_url: img,
    backdrop_url: img,
    imdb_id: show.externals?.imdb || null,
    external_rating: show.rating?.average || null,
    popularity: show.weight || null,
    metadata: {
      status: show.status,
      tvmaze_id: show.id,
      thetvdb: show.externals?.thetvdb,
      official_site: show.officialSite,
      country: show.network?.country?.code,
      ended: show.ended,
    },
  }
}

export async function search(term, limit = 10) {
  if (!term) return []
  try {
    const data = await fetchJson(`${BASE}/search/shows?q=${encodeURIComponent(term)}`, {
      ttlSeconds: 60 * 60 * 24 * 14,
    })
    return (data || []).slice(0, limit).map((r) => normalise(r.show)).filter(Boolean)
  } catch {
    return []
  }
}

export async function byImdb(imdbId) {
  if (!imdbId) return null
  try {
    return normalise(await fetchJson(`${BASE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`))
  } catch {
    return null
  }
}

/** Shows in a genre, ranked by TVmaze rating — candidate generation. */
export async function byGenre(genre, { limit = 24, pages = 8, minRating = 8 } = {}) {
  if (!genre) return []
  const want = String(genre).toLowerCase()
  const out = []
  for (let page = 0; page < pages; page++) {
    try {
      const data = await fetchJson(`${BASE}/shows?page=${page}`, { ttlSeconds: 60 * 60 * 24 * 30 })
      for (const show of data || []) {
        if ((show.genres || []).some((g) => g.toLowerCase() === want) && (show.rating?.average || 0) >= minRating) {
          const n = normalise(show)
          if (n) out.push(n)
        }
      }
    } catch { break }
  }
  return out.sort((a, b) => (b.external_rating || 0) - (a.external_rating || 0)).slice(0, limit)
}
