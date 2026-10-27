import { fetchJson } from '../lib/http.js'
import { setting } from '../lib/settings.js'

/**
 * Public scores for film and TV. OMDb is the only free source that returns
 * IMDb, Rotten Tomatoes and Metacritic together, so one request fills the
 * whole strip. It needs a free key (1,000 requests a day).
 */
const BASE = 'https://www.omdbapi.com/'

export function hasKey() {
  return Boolean(setting('omdb_api_key'))
}

function url(params) {
  const qs = new URLSearchParams({ apikey: setting('omdb_api_key'), ...params })
  return `${BASE}?${qs}`
}

/** Ratings for one title, by IMDb id where we have one, else by name and year. */
/*
 * OMDb's free tier allows a thousand requests a day, and once it is spent
 * every further call is a 401 that still costs a round trip — eighteen of
 * them was six seconds of waiting to be told no eighteen times. One refusal
 * is enough to know; back off for an hour and let the badges go missing,
 * which is what they would do anyway.
 */
let limitedUntil = 0

export function isRateLimited() {
  return Date.now() < limitedUntil
}

export async function ratings({ imdbId, title, year, type }) {
  if (!hasKey()) return null
  if (!imdbId && !title) return null
  if (isRateLimited()) return null

  const params = imdbId
    ? { i: imdbId }
    : { t: title, ...(year ? { y: String(year) } : {}), ...(type ? { type: type === 'tv' ? 'series' : 'movie' } : {}) }

  let data
  try {
    data = await fetchJson(url(params), { ttlSeconds: 60 * 60 * 24 * 14 })
  } catch (err) {
    // 401 is both "key is spent" and "key is wrong". Either way, stop asking.
    if (err?.status === 401) limitedUntil = Date.now() + 60 * 60 * 1000
    return null
  }
  if (data?.Error && /request limit/i.test(data.Error)) {
    limitedUntil = Date.now() + 60 * 60 * 1000
    return null
  }
  if (!data || data.Response === 'False') return null

  const out = []

  // IMDb's own score, out of ten, with the vote count that gives it weight.
  const imdb = Number(data.imdbRating)
  if (Number.isFinite(imdb) && imdb > 0) {
    out.push({
      source: 'IMDb',
      score: imdb,
      scale: 10,
      display: imdb.toFixed(1),
      votes: Number(String(data.imdbVotes || '').replace(/[^\d]/g, '')) || null,
      url: data.imdbID ? `https://www.imdb.com/title/${data.imdbID}/` : null,
    })
  }

  for (const r of data.Ratings || []) {
    if (r.Source === 'Rotten Tomatoes') {
      const pct = Number(String(r.Value).replace('%', ''))
      if (Number.isFinite(pct)) {
        out.push({
          source: 'Rotten Tomatoes',
          score: pct / 10,
          scale: 10,
          display: `${pct}%`,
          url: `https://www.rottentomatoes.com/search?search=${encodeURIComponent(data.Title || title || '')}`,
        })
      }
    }
    if (r.Source === 'Metacritic') {
      const pct = Number(String(r.Value).split('/')[0])
      if (Number.isFinite(pct)) {
        out.push({ source: 'Metacritic', score: pct / 10, scale: 10, display: String(pct), url: null })
      }
    }
  }

  return { imdbId: data.imdbID || imdbId || null, ratings: out }
}
