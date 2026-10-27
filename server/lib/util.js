export const TYPES = ['film', 'tv', 'book', 'audiobook', 'album', 'track', 'podcast', 'game']

export const SECTIONS = {
  film: { label: 'Films', singular: 'Film', verb: 'watched' },
  tv: { label: 'TV', singular: 'Show', verb: 'watched' },
  book: { label: 'Books', singular: 'Book', verb: 'read' },
  audiobook: { label: 'Audiobooks', singular: 'Audiobook', verb: 'listened to' },
  album: { label: 'Music', singular: 'Album', verb: 'listened to' },
  track: { label: 'Tracks', singular: 'Track', verb: 'listened to' },
  podcast: { label: 'Podcasts', singular: 'Podcast', verb: 'listened to' },
  game: { label: 'Games', singular: 'Game', verb: 'played' },
}

const ARTICLES = /^(the|a|an|le|la|les|el|los|das|der|die)\s+/i

export function sortTitle(title) {
  return String(title || '').trim().replace(ARTICLES, '').toLowerCase()
}

/** Loose key used to decide "is this the same work?" */
export function matchKey(type, title, year) {
  return [type, normaliseTitle(title), year || ''].join('|')
}

export function normaliseTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[‘’“”]/g, "'")
    .replace(/\s*[:\-–—]\s*(the\s+)?(complete|extended|special|director'?s|unrated|remastered|deluxe)\b.*$/i, '')
    .replace(/\s*\((19|20)\d{2}\)\s*$/, '')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    // A leading article is an edition's whim, not part of the title: Open
    // Library lists both "A Thousand Splendid Suns" and "Thousand Splendid
    // Suns", and they should not both be offered to you.
    .replace(/^(the|a|an)\s+/, '')
}

export function parseYear(value) {
  if (value == null) return null
  const m = String(value).match(/(18|19|20|21)\d{2}/)
  return m ? Number(m[0]) : null
}

/** Accepts 2024-01-02, 2024/01/02, 02/01/2024, "Jan 02, 2024", ISO timestamps. */
export function parseDate(value) {
  if (!value) return null
  const s = String(value).trim()
  if (!s) return null
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (m) {
    const [, a, b, y] = m
    // Day-first unless impossible (the user is in the UK).
    const day = Number(a) > 12 ? a : Number(b) > 12 ? b : a
    const month = day === a ? b : a
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const d = new Date(s)
  if (!Number.isNaN(d.valueOf()) && d.getFullYear() > 1800) return d.toISOString().slice(0, 10)
  return null
}

/** Map any source's rating onto our 0.5–5 half-star scale. */
export function parseRating(value, scale = 5) {
  if (value == null || value === '') return null
  const n = Number(String(value).replace(',', '.').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  const out = scale === 5 ? n : (n / scale) * 5
  return Math.min(5, Math.max(0.5, Math.round(out * 2) / 2))
}

export function parseRuntime(value) {
  if (!value) return null
  const s = String(value).trim()
  let m = s.match(/^(\d+)\s*(?:hrs?|hours?|h)\s*(?:and\s*)?(\d+)?\s*(?:mins?|minutes?|m)?/i)
  if (m) return Number(m[1]) * 60 + Number(m[2] || 0)
  m = s.match(/^(\d+)\s*(?:mins?|minutes?|m)\b/i)
  if (m) return Number(m[1])
  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const n = Number(s.replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function splitPeople(value) {
  if (!value) return []
  return String(value)
    .split(/,|;|\band\b|\&|\//i)
    .map((s) => s.trim())
    .filter((s) => s && s.length < 80)
}

export function decade(year) {
  return year ? `${Math.floor(year / 10) * 10}s` : null
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'list'
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

export function uniqueBy(items, keyFn) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const k = keyFn(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ genres */

// Providers disagree about case and naming ("drama" / "Drama", "sci-fi" /
// "Science Fiction"). Canonicalise on write so one genre is one genre — the
// filter chips and the taste profile both depend on it.
const GENRE_SYNONYMS = {
  'sci fi': 'Science Fiction',
  'scifi': 'Science Fiction',
  'science-fiction': 'Science Fiction',
  'sciencefiction': 'Science Fiction',
  'rom com': 'Romantic Comedy',
  'romcom': 'Romantic Comedy',
  'docu': 'Documentary',
  'documentary film': 'Documentary',
  'biographical film': 'Biography',
  'biographical': 'Biography',
  'biopic': 'Biography',
  'tv movie': 'TV Movie',
  'hip hop': 'Hip-Hop',
  'hiphop': 'Hip-Hop',
  'rnb': 'R&B',
  'r b': 'R&B',
  'singer songwriter': 'Singer-Songwriter',
  'non fiction': 'Non-Fiction',
  'nonfiction': 'Non-Fiction',
  'ya': 'Young Adult',
  'lgbtq related': 'LGBTQ+',
  'lgbt': 'LGBTQ+',
  'children s literature': "Children's Literature",
  'film noir': 'Film Noir',
  'neo noir': 'Neo-Noir',
  'coming of age': 'Coming of Age',
  'psychological thriller film': 'Psychological Thriller',
  'action adventure game': 'Action-Adventure',
  'drama film': 'Drama',
  'comedy film': 'Comedy',
  'horror film': 'Horror',
  'thriller film': 'Thriller',
  'mystery film': 'Mystery',
  'war film': 'War',
  'crime film': 'Crime',
  'historical film': 'History',
  'historical drama': 'Historical Drama',
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with'])

export function canonicalGenre(raw) {
  let g = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!g || g.length > 40) return null
  const key = g.toLowerCase().replace(/[^a-z0-9+&]+/g, ' ').trim()
  if (GENRE_SYNONYMS[key]) return GENRE_SYNONYMS[key]
  // Already mixed case from a careful source (e.g. "Film-Noir"): keep it.
  if (/[a-z]/.test(g) && /[A-Z]/.test(g) && !/^[a-z]/.test(g)) return g
  return g
    .toLowerCase()
    .split(' ')
    .map((word, i) => {
      if (i > 0 && SMALL_WORDS.has(word)) return word
      return word.replace(/^[a-z\u00e0-\u00ff]/, (c) => c.toUpperCase())
    })
    .join(' ')
    .replace(/\b(Tv|Bbc|Hbo|Us|Uk|Lgbtq)\b/g, (m) => m.toUpperCase())
}

export function canonicalGenres(list) {
  const out = []
  const seen = new Set()
  for (const raw of list || []) {
    const g = canonicalGenre(raw)
    if (!g) continue
    const key = g.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(g)
  }
  return out
}
