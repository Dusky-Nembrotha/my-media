import { fetchJson } from '../lib/http.js'
import { setting } from '../lib/settings.js'
import { parseYear } from '../lib/util.js'

// Optional: needs a free API key pasted into Settings. Far richer than the
// keyless sources for film and TV (genres, cast, keywords, similar titles).
const BASE = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p'

export function hasKey() {
  return Boolean(setting('tmdb_api_key'))
}

function url(path, params = {}) {
  const key = setting('tmdb_api_key')
  const qs = new URLSearchParams({ api_key: key, language: 'en-GB', ...params })
  return `${BASE}${path}?${qs}`
}

const poster = (p, size = 'w500') => (p ? `${IMG}/${size}${p}` : null)

function normalise(item, type) {
  const isTv = type === 'tv'
  const title = isTv ? item.name : item.title
  if (!title) return null
  const date = isTv ? item.first_air_date : item.release_date
  const creators = []
  for (const c of item.credits?.crew || []) {
    if ((isTv ? ['Creator', 'Executive Producer'] : ['Director']).includes(c.job)) {
      creators.push({ role: c.job, name: c.name })
    }
  }
  for (const c of item.created_by || []) creators.push({ role: 'Creator', name: c.name })
  for (const c of (item.credits?.cast || []).slice(0, 6)) creators.push({ role: 'Cast', name: c.name })

  return {
    provider: 'tmdb',
    type,
    title,
    original_title: isTv ? item.original_name : item.original_title,
    year: parseYear(date),
    release_date: date || null,
    creators,
    genres: (item.genres || []).map((g) => g.name).filter(Boolean),
    overview: item.overview || null,
    runtime: item.runtime || (item.episode_run_time || [])[0] || null,
    seasons: item.number_of_seasons || null,
    episodes: item.number_of_episodes || null,
    language: item.original_language || null,
    poster_url: poster(item.poster_path, 'w500'),
    backdrop_url: poster(item.backdrop_path, 'w1280'),
    tmdb_id: String(item.id),
    imdb_id: item.imdb_id || item.external_ids?.imdb_id || null,
    external_rating: item.vote_average || null,
    popularity: item.popularity || null,
    metadata: {
      genre_ids: (item.genres || []).map((g) => g.id),
      keywords: ((item.keywords?.keywords || item.keywords?.results || []).map((k) => k.name)).slice(0, 15),
      vote_count: item.vote_count,
      countries: (item.production_countries || []).map((c) => c.iso_3166_1),
      companies: (item.production_companies || []).map((c) => c.name).slice(0, 4),
      status: item.status,
      tagline: item.tagline,
    },
  }
}

export async function search(type, term, limit = 12) {
  if (!hasKey() || !term) return []
  const path = type === 'tv' ? '/search/tv' : '/search/movie'
  try {
    const data = await fetchJson(url(path, { query: term, include_adult: 'false' }), { ttlSeconds: 60 * 60 * 24 * 7 })
    return (data.results || []).slice(0, limit).map((r) => normalise(r, type)).filter(Boolean)
  } catch {
    return []
  }
}

export async function detail(type, id) {
  if (!hasKey() || !id) return null
  const path = type === 'tv' ? `/tv/${id}` : `/movie/${id}`
  try {
    const data = await fetchJson(url(path, { append_to_response: 'credits,keywords,external_ids' }), {
      ttlSeconds: 60 * 60 * 24 * 30,
    })
    return normalise(data, type)
  } catch {
    return null
  }
}

export async function recommendations(type, id, limit = 20) {
  if (!hasKey() || !id) return []
  const path = type === 'tv' ? `/tv/${id}/recommendations` : `/movie/${id}/recommendations`
  try {
    const data = await fetchJson(url(path), { ttlSeconds: 60 * 60 * 24 * 7 })
    return (data.results || []).slice(0, limit).map((r) => normalise(r, type)).filter(Boolean)
  } catch {
    return []
  }
}

export async function discover(type, { genreIds = [], people = [], yearFrom, yearTo, limit = 24 } = {}) {
  if (!hasKey()) return []
  const path = type === 'tv' ? '/discover/tv' : '/discover/movie'
  const params = {
    sort_by: 'vote_average.desc',
    'vote_count.gte': type === 'tv' ? '200' : '400',
    include_adult: 'false',
  }
  if (genreIds.length) params.with_genres = genreIds.join('|')
  if (people.length) params.with_people = people.join('|')
  if (yearFrom) params[type === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte'] = `${yearFrom}-01-01`
  if (yearTo) params[type === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte'] = `${yearTo}-12-31`
  try {
    const data = await fetchJson(url(path, params), { ttlSeconds: 60 * 60 * 24 * 3 })
    return (data.results || []).slice(0, limit).map((r) => normalise(r, type)).filter(Boolean)
  } catch {
    return []
  }
}

export async function findByExternalId(externalId, type) {
  if (!hasKey() || !externalId) return null
  try {
    const data = await fetchJson(url(`/find/${externalId}`, { external_source: 'imdb_id' }), {
      ttlSeconds: 60 * 60 * 24 * 30,
    })
    const hit = type === 'tv' ? (data.tv_results || [])[0] : (data.movie_results || [])[0]
    if (!hit) return null
    return detail(type, hit.id)
  } catch {
    return null
  }
}

export async function trending(type, limit = 20) {
  if (!hasKey()) return []
  try {
    const data = await fetchJson(url(`/trending/${type === 'tv' ? 'tv' : 'movie'}/week`), { ttlSeconds: 60 * 60 * 12 })
    return (data.results || []).slice(0, limit).map((r) => normalise(r, type)).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Where you can actually watch something.
 *
 * TMDB licenses this from JustWatch, which is why the response carries a
 * JustWatch deep link — and why their terms require JustWatch to be credited
 * wherever it is shown.
 */
export async function watchProviders(type, id, region = 'GB') {
  if (!hasKey() || !id) return null
  const path = type === 'tv' ? `/tv/${id}/watch/providers` : `/movie/${id}/watch/providers`
  try {
    const data = await fetchJson(url(path), { ttlSeconds: 60 * 60 * 24 })
    const here = data?.results?.[region]
    if (!here) return { region, link: null, stream: [], rent: [], buy: [], free: [] }

    const shape = (list) => (list || []).map((p) => ({
      name: p.provider_name,
      logo: p.logo_path ? `${IMG}/w92${p.logo_path}` : null,
      priority: p.display_priority ?? 99,
    })).sort((a, b) => a.priority - b.priority)

    return {
      region,
      link: here.link || null,          // the JustWatch page for this title
      stream: shape(here.flatrate),
      free: shape([...(here.free || []), ...(here.ads || [])]),
      rent: shape(here.rent),
      buy: shape(here.buy),
    }
  } catch {
    return null
  }
}

/** Every poster TMDB holds for a title, best first. */
export async function images(type, id) {
  if (!hasKey() || !id) return []
  const path = type === 'tv' ? `/tv/${id}/images` : `/movie/${id}/images`
  try {
    const data = await fetchJson(url(path, { include_image_language: 'en,null' }), { ttlSeconds: 60 * 60 * 24 * 7 })
    return (data?.posters || [])
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, 12)
      .map((p) => ({
        url: poster(p.file_path, 'w500'),
        full: poster(p.file_path, 'original'),
        width: p.width,
        height: p.height,
        language: p.iso_639_1,
        source: 'TMDB',
      }))
      .filter((p) => p.url)
  } catch {
    return []
  }
}
