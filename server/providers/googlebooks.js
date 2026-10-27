import { fetchJson } from '../lib/http.js'
import { setting } from '../lib/settings.js'
import { parseYear, plainText } from '../lib/util.js'

/**
 * Google Books.
 *
 * Open Library describes a *work* — every edition in every language rolled
 * into one record — which is why it hands back Turkish covers for English
 * novels, credits forewords as authorship, and has no series information at
 * all. Google describes a specific published volume, so its titles, authors,
 * page counts and descriptions are the publisher's own and far steadier.
 *
 * Open Library is still the better source of cover art and is free of quotas,
 * so the two are used together rather than one replacing the other.
 */
const BASE = 'https://www.googleapis.com/books/v1/volumes'

export function hasKey() {
  return Boolean(setting('google_books_api_key'))
}

function url(params) {
  const key = setting('google_books_api_key')
  const qs = new URLSearchParams({
    ...params,
    // Without a country the API refuses anonymous-looking requests.
    country: (setting('watch_region') || 'GB').toUpperCase(),
    ...(key ? { key } : {}),
  })
  return `${BASE}?${qs}`
}

/** Their thumbnails come back tiny and over http; ask for something usable. */
function cover(links) {
  const raw = links?.extraLarge || links?.large || links?.medium || links?.thumbnail || links?.smallThumbnail
  if (!raw) return null
  return String(raw)
    .replace(/^http:/, 'https:')
    .replace(/&zoom=\d+/, '&zoom=1')
    .replace(/&edge=curl/, '')
}

function normalise(item, type = 'book') {
  const v = item?.volumeInfo
  if (!v?.title) return null

  const isbn13 = (v.industryIdentifiers || []).find((i) => i.type === 'ISBN_13')?.identifier
  const isbn10 = (v.industryIdentifiers || []).find((i) => i.type === 'ISBN_10')?.identifier

  return {
    provider: 'googlebooks',
    type,
    // The subtitle is kept separate: it is what turns "Gardens of the Moon"
    // into a different-looking record from the same book elsewhere.
    title: v.title,
    subtitle: v.subtitle || null,
    year: parseYear(v.publishedDate),
    release_date: /^\d{4}-\d{2}-\d{2}$/.test(v.publishedDate || '') ? v.publishedDate : null,
    creators: (v.authors || []).slice(0, 4).map((name) => ({ role: 'Author', name })),
    genres: (v.categories || []).flatMap((c) => String(c).split(/\s*\/\s*/)).slice(0, 8),
    overview: plainText(v.description),
    pages: v.pageCount || null,
    language: v.language === 'en' ? 'eng' : (v.language || null),
    poster_url: cover(v.imageLinks),
    backdrop_url: null,
    isbn: isbn13 || isbn10 || null,
    // Google rates out of five; everything here is on a ten-point scale.
    external_rating: v.averageRating ? Math.round(v.averageRating * 20) / 10 : null,
    popularity: v.ratingsCount || null,
    metadata: {
      google_id: item.id,
      ratings_count: v.ratingsCount ?? null,
      publisher: v.publisher || null,
      google_url: v.canonicalVolumeLink || v.infoLink || null,
      maturity: v.maturityRating || null,
    },
  }
}

export async function search(term, { limit = 10, author, type = 'book' } = {}) {
  if (!hasKey() || (!term && !author)) return []
  /*
   * Plain terms, not intitle:/inauthor:. Google's field operators return
   * nothing at all here — "intitle:\"The Blade Itself\" inauthor:\"Joe
   * Abercrombie\"" finds zero results while the same words unqualified find
   * twenty-two, the first of them the right book. Matching is done by
   * chooseBest afterwards, which is stricter than the operators anyway.
   */
  const q = [term, author].filter(Boolean).join(' ')
  try {
    const data = await fetchJson(
      url({ q, maxResults: String(Math.min(40, limit)), printType: 'books', orderBy: 'relevance' }),
      { ttlSeconds: 60 * 60 * 24 * 14 },
    )
    return (data.items || []).map((i) => normalise(i, type)).filter(Boolean)
  } catch {
    return []
  }
}

export async function byIsbn(isbn, type = 'book') {
  if (!hasKey() || !isbn) return null
  try {
    const data = await fetchJson(url({ q: `isbn:${isbn}`, maxResults: '1' }), { ttlSeconds: 60 * 60 * 24 * 30 })
    return (data.items || []).map((i) => normalise(i, type)).filter(Boolean)[0] || null
  } catch {
    return null
  }
}

/** Everything by one author, for "more from this person". */
export async function byAuthor(author, { limit = 24, type = 'book' } = {}) {
  if (!hasKey() || !author) return []
  try {
    const data = await fetchJson(
      url({ q: author, maxResults: String(Math.min(40, limit)), printType: 'books', orderBy: 'relevance' }),
      { ttlSeconds: 60 * 60 * 24 * 7 },
    )
    // A plain name query drags in books merely *about* the person, so keep
    // only the ones they actually wrote.
    const wanted = String(author).toLowerCase()
    return (data.items || [])
      .map((i) => normalise(i, type))
      .filter(Boolean)
      .filter((b) => b.creators.some((c) => String(c.name).toLowerCase().includes(wanted.split(' ').pop())))
  } catch {
    return []
  }
}
