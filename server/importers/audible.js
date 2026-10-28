import { parseCsvObjects, columnIndex, pick, hasAnyColumn } from '../lib/csv.js'
import { parseDate, parseRating, parseYear, parseRuntime, splitPeople, normaliseTitle } from '../lib/util.js'
import { record, keyFor } from './shared.js'

export const id = 'audible'
export const label = 'Audible'
export const accepts = ['.csv', '.tsv', '.json', '.zip']
export const help = 'Amazon → Account → Request Your Data → "Audible", then upload the zip whole. '
  + 'Any CSV with Title / Author / Narrator columns works too.'

/*
 * Which files in an Audible export are about books.
 *
 * The export is now a folder of twenty-odd files, and most of them are
 * telemetry: playback metrics, search terms, device activations, billing.
 * Several carry a "Product Name" column, so reading everything turned 198
 * owned titles into 23,606 "audiobooks" — one per playback event.
 */
const LIBRARY_FILE = /(^|\/)(audible[._ ]?)?library\.csv$/i
const HISTORY_FILE = /(^|\/)(audible[._ ]?)?listening[ ._-]*history\.csv$/i
const LEGACY_LISTEN = /(^|\/)audible[._ ]?listening\.csv$/i
const WISHLIST_FILE = /(^|\/)wishlist\.csv$/i

export function relevantFilename(name) {
  const n = String(name || '')
  return LIBRARY_FILE.test(n) || HISTORY_FILE.test(n) || LEGACY_LISTEN.test(n) || WISHLIST_FILE.test(n)
}

export function detect({ filename, headers }) {
  const name = String(filename || '').toLowerCase()
  if (relevantFilename(name)) return { confidence: 0.98, reason: 'Audible export' }
  if (name.includes('audible')) return { confidence: 0.9, reason: 'Audible data-request filename' }
  if (headers && hasAnyColumn(headers, ['narrator', 'narrators', 'narrated by', 'audiobook narrator'])) {
    return { confidence: 0.9, reason: 'Narrator column' }
  }
  if (headers && hasAnyColumn(headers, ['asin']) && hasAnyColumn(headers, ['title'])) {
    return { confidence: 0.6, reason: 'ASIN + Title columns' }
  }
  return { confidence: 0 }
}

const CLEAN = /\s*[:(]\s*(Unabridged|Abridged)\s*\)?\s*$/i
const tidy = (t) => String(t || '').replace(CLEAN, '').replace(/\s{2,}/g, ' ').trim()
const absent = (v) => !v || /^not available$/i.test(String(v).trim())
const val = (v) => (absent(v) ? '' : String(v).trim())

/** "asin:B09…,title:Dungeon Crawler Carl" → "Dungeon Crawler Carl" */
function seriesOf(raw) {
  const m = /title:([^,]+)/i.exec(val(raw))
  return m ? m[1].trim() : null
}

export function parse(files) {
  /*
   * One book can appear many times over: the library lists a row per
   * acquisition (198 rows, 105 books) and the history a row per sitting
   * (13,449 rows, 165 books). Everything is therefore keyed by ASIN and
   * merged, rather than emitted a row at a time.
   */
  const books = new Map()
  const listens = new Map()
  const wishes = new Map()

  const slot = (map, key, seed) => {
    if (!map.has(key)) map.set(key, seed)
    return map.get(key)
  }

  for (const file of files) {
    const name = String(file.filename || '')
    let parsed
    try { parsed = parseCsvObjects(file.text) } catch { continue }
    const { headers, rows } = parsed
    const idx = columnIndex(headers)

    const isHistory = HISTORY_FILE.test(name) || LEGACY_LISTEN.test(name)
      || hasAnyColumn(headers, ['end position milliseconds', 'listening time', 'percent complete'])
    const isWishlist = WISHLIST_FILE.test(name)

    for (const row of rows) {
      const asin = val(pick(row, ['ASIN', 'Asin', 'product id'], idx)) || null
      const rawTitle = pick(row, ['Title', 'Book Title', 'Product Name'], idx)
      const title = tidy(rawTitle)
      if (!title) continue
      const key = asin || normaliseTitle(title)
      if (!key) continue

      if (isWishlist) {
        slot(wishes, key, { asin, title })
        continue
      }

      if (isHistory) {
        const s = slot(listens, key, {
          asin, title, first: null, last: null, furthest: 0, length: 0, percent: null, sessions: 0,
        })
        s.sessions++
        if (!s.title) s.title = title
        const start = parseDate(val(pick(row, ['Start Date', 'Date'], idx)))
        const end = parseDate(val(pick(row, ['End Date', 'Date'], idx)))
        if (start && (!s.first || start < s.first)) s.first = start
        for (const d of [start, end]) if (d && (!s.last || d > s.last)) s.last = d
        const pos = Number(pick(row, ['End Position Milliseconds'], idx)) || 0
        const len = Number(pick(row, ['Book Length Milliseconds'], idx)) || 0
        if (pos > s.furthest) s.furthest = pos
        if (len > s.length) s.length = len
        // The older two-file export stated a percentage outright.
        const pct = Number(String(pick(row, ['Percent Complete', 'percentage complete'], idx)).replace('%', ''))
        if (Number.isFinite(pct) && pct > (s.percent ?? 0)) s.percent = pct
        continue
      }

      // Otherwise: a library row, or any hand-rolled CSV of audiobooks.
      const b = slot(books, key, { asin, title, rows: 0 })
      b.rows++
      b.title = b.title || title
      const authors = splitPeople(val(pick(row, ['Authors', 'Author', 'Written By'], idx)))
      const narrators = splitPeople(val(pick(row, ['Audiobook Narrator', 'Narrator', 'Narrators', 'Narrated By'], idx)))
      if (authors.length) b.authors = authors
      if (narrators.length) b.narrators = narrators
      b.publisher = b.publisher || val(pick(row, ['Publisher'], idx)) || null
      b.series = b.series || seriesOf(pick(row, ['Book Series Info', 'Series', 'Series Title'], idx))
      b.language = b.language || val(pick(row, ['Language'], idx)) || null
      b.year = b.year || parseYear(val(pick(row, ['Publication Date', 'Release Date', 'Year'], idx)))
      b.rating = b.rating ?? parseRating(pick(row, ['My Rating', 'Overall Rating', 'Rating'], idx))
      b.review = b.review || val(pick(row, ['My Review', 'Review'], idx)) || null
      b.genres = b.genres?.length ? b.genres
        : val(pick(row, ['Category', 'Categories', 'Genre'], idx)).split(/[,;|>]/).map((s) => s.trim()).filter(Boolean)

      const minutes = Number(pick(row, ['Length in Minutes'], idx))
      b.runtime = b.runtime || (Number.isFinite(minutes) && minutes > 0
        ? Math.round(minutes)
        : parseRuntime(val(pick(row, ['Length', 'Runtime', 'Duration', 'Run Time'], idx))))

      const bought = parseDate(val(pick(row, ['Purchase Date', 'Date Added', 'Order Date', 'DateAdded'], idx)))
      if (bought && (!b.bought || bought < b.bought)) b.bought = bought
      if (/yes|true|finished|complete/i.test(val(pick(row, ['Is Finished', 'Finished', 'Status'], idx)))) b.finished = true
      const done = parseDate(val(pick(row, ['Date Finished', 'Completion Date', 'Last Played'], idx)))
      if (done && (!b.done || done > b.done)) b.done = done
    }
  }

  /*
   * A title listened to but never owned is still a title listened to —
   * Audible Plus and borrowed books account for ninety-seven of them here.
   */
  for (const [key, l] of listens) {
    if (!books.has(key)) books.set(key, { asin: l.asin, title: l.title, rows: 0, borrowed: true })
  }

  const out = []

  for (const [key, b] of books) {
    const l = listens.get(key)
    const reached = l && l.length ? l.furthest / l.length : null
    const percent = l?.percent ?? (reached != null ? reached * 100 : null)
    const complete = Boolean(b.finished) || (percent != null && percent >= 95)
    /*
     * Opening something is not listening to it. Thirty-five titles here were
     * touched for under a minute — samples, mis-taps, a browse — and logging
     * those as "in progress, 0%" fills a library with books nobody started.
     * Two minutes in, or one per cent through, counts.
     */
    const started = (l && (l.furthest >= 2 * 60 * 1000 || (percent ?? 0) >= 1))
      || (!l && percent != null && percent >= 2)

    const base = {
      type: 'audiobook',
      title: b.title,
      year: b.year ?? null,
      creators: [
        ...(b.authors || []).map((name) => ({ role: 'Author', name })),
        ...(b.narrators || []).map((name) => ({ role: 'Narrator', name })),
      ],
      asin: b.asin,
      runtime: b.runtime || (l?.length ? Math.round(l.length / 60000) : null),
      genres: b.genres || [],
      metadata: {
        audible_asin: b.asin,
        narrators: b.narrators || [],
        publisher: b.publisher || null,
        series: b.series || null,
        audible_url: b.asin ? `https://www.audible.co.uk/pd/${b.asin}` : null,
      },
    }

    if (!started) {
      /*
       * A sample of something you do not own is not part of your library at
       * all — there is nothing to queue and nothing to log.
       */
      if (b.borrowed) continue
      // Owned and never started: a queue, not a log entry.
      out.push(record({
        ...base,
        kind: 'rec',
        recommender: 'Audible library',
        note: 'In your Audible library, not started',
        source_url: base.metadata.audible_url,
        external_key: keyFor('audible', 'library', [key]),
      }))
      continue
    }

    out.push(record({
      ...base,
      kind: 'entry',
      status: complete ? 'completed' : 'in_progress',
      rating: b.rating ?? null,
      // The day you finished it beats the day you bought it.
      consumed_on: complete ? (l?.last || b.done || b.bought || null) : null,
      progress: !complete && percent != null ? `${Math.round(percent)}%` : null,
      review: b.review || null,
      format: 'audiobook',
      external_key: keyFor('audible', 'listen', [key]),
    }))
  }

  for (const [key, w] of wishes) {
    if (books.has(key)) continue
    out.push(record({
      type: 'audiobook',
      title: w.title,
      kind: 'rec',
      recommender: 'Audible wishlist',
      note: 'On your Audible wishlist',
      asin: w.asin,
      metadata: { audible_asin: w.asin, audible_url: w.asin ? `https://www.audible.co.uk/pd/${w.asin}` : null },
      source_url: w.asin ? `https://www.audible.co.uk/pd/${w.asin}` : null,
      external_key: keyFor('audible', 'wishlist', [key]),
    }))
  }

  return out
}
