import { fetchJson } from '../lib/http.js'

// Keyless. Great for books: covers, subjects, author graph, ratings.
const BASE = 'https://openlibrary.org'
const FIELDS = [
  'key', 'title', 'author_name', 'author_key', 'first_publish_year', 'cover_i', 'isbn',
  'subject', 'number_of_pages_median', 'edition_count', 'ratings_average', 'ratings_count',
  'language', 'first_sentence', 'publisher',
].join(',')

export function coverUrl(coverId, size = 'L') {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null
}

// Open Library subjects are a jumble: "genre:fantasy", "nyt:bestseller",
// "Fiction, fantasy, epic". Tidy them into things worth showing as genres.
const SUBJECT_NOISE = new RegExp([
  '^(nyt|accessible book|protected daisy|in library|overdrive|large type|internet archive',
  '|open library|lending library|popular print|reading level|ficci|roman|romans|erzahlung)',
  '|englisch|deutsch|fran[cç]ais|espa[nñ]ol|italiano|translations? into|fiction in english',
  '|new york times|bestseller|book club|reading group|textbooks?|study guide|abridged',
].join(''), 'i')

export function cleanSubjects(subjects) {
  const out = []
  for (const raw of subjects || []) {
    let s = String(raw).replace(/^(genre|form|subject|place|time|person|lcc|ddc):\s*/i, '').trim()
    if (!s || s.length > 34 || SUBJECT_NOISE.test(s)) continue
    if (/^\d+$/.test(s)) continue
    s = s.replace(/\s*\(.*?\)\s*$/, '').trim()
    s = s.charAt(0).toUpperCase() + s.slice(1)
    out.push(s)
  }
  return out
}

function normalise(doc, type = 'book') {
  if (!doc || !doc.title) return null
  return {
    provider: 'openlibrary',
    type,
    title: doc.title,
    year: doc.first_publish_year || null,
    creators: (doc.author_name || []).slice(0, 4).map((name) => ({ role: 'Author', name })),
    genres: cleanSubjects(doc.subject).slice(0, 12),
    overview: Array.isArray(doc.first_sentence) ? doc.first_sentence[0] : doc.first_sentence || null,
    pages: doc.number_of_pages_median || null,
    poster_url: coverUrl(doc.cover_i, 'L'),
    backdrop_url: null,
    isbn: (doc.isbn || [])[0] || null,
    olid: doc.key ? String(doc.key).replace('/works/', '') : null,
    external_rating: doc.ratings_average ? Math.round(doc.ratings_average * 20) / 10 : null,
    popularity: doc.edition_count || null,
    language: (doc.language || [])[0] || null,
    metadata: {
      author_keys: doc.author_key || [],
      ratings_count: doc.ratings_count,
      publisher: (doc.publisher || [])[0],
      ol_key: doc.key,
    },
  }
}

export async function search(term, { limit = 12, type = 'book', author } = {}) {
  if (!term && !author) return []
  const q = author ? `${term} author:${author}` : term
  try {
    const data = await fetchJson(
      `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=${FIELDS}`,
      { ttlSeconds: 60 * 60 * 24 * 14 },
    )
    return (data.docs || []).map((d) => normalise(d, type)).filter(Boolean)
  } catch {
    return []
  }
}

export async function byIsbn(isbn, type = 'book') {
  try {
    const data = await fetchJson(
      `${BASE}/search.json?q=isbn:${encodeURIComponent(isbn)}&limit=1&fields=${FIELDS}`,
    )
    return (data.docs || []).map((d) => normalise(d, type))[0] || null
  } catch {
    return null
  }
}

export async function byAuthorKey(authorKey, { limit = 24, type = 'book' } = {}) {
  if (!authorKey) return []
  try {
    const data = await fetchJson(
      `${BASE}/search.json?q=author_key:${encodeURIComponent(authorKey)}&sort=rating&limit=${limit}&fields=${FIELDS}`,
      { ttlSeconds: 60 * 60 * 24 * 7 },
    )
    return (data.docs || []).map((d) => normalise(d, type)).filter(Boolean)
  } catch {
    return []
  }
}

/** Highly-rated books in a subject — candidate generation for the recommender. */
export async function bySubject(subject, { limit = 24, type = 'book' } = {}) {
  if (!subject) return []
  const q = `subject:"${String(subject).replace(/"/g, '')}"`
  try {
    const data = await fetchJson(
      `${BASE}/search.json?q=${encodeURIComponent(q)}&sort=rating&limit=${limit}&fields=${FIELDS}`,
      { ttlSeconds: 60 * 60 * 24 * 7 },
    )
    return (data.docs || []).map((d) => normalise(d, type)).filter(Boolean)
  } catch {
    return []
  }
}

export async function workDetail(olid) {
  if (!olid) return null
  try {
    const data = await fetchJson(`${BASE}/works/${olid}.json`)
    const desc = typeof data.description === 'string' ? data.description : data.description?.value
    return { overview: desc || null, subjects: data.subjects || [] }
  } catch {
    return null
  }
}
