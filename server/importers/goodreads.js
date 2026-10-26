import { parseCsvObjects, columnIndex, pick, hasAnyColumn } from '../lib/csv.js'
import { parseDate, parseRating, parseYear, splitPeople, normaliseTitle } from '../lib/util.js'
import { record, keyFor } from './shared.js'

export const id = 'goodreads'
export const label = 'Goodreads'
export const accepts = ['.csv']
export const help = 'Goodreads → My Books → Import and export → Export Library. '
  + 'Upload goodreads_library_export.csv. Shelves become status, "to-read" becomes recommendations.'

export function detect({ filename, headers }) {
  const name = String(filename || '').toLowerCase()
  if (name.includes('goodreads')) return { confidence: 0.98, reason: 'Goodreads export filename' }
  if (headers && hasAnyColumn(headers, ['exclusive shelf'])) {
    return { confidence: 0.95, reason: 'Exclusive Shelf column' }
  }
  if (headers && hasAnyColumn(headers, ['my rating']) && hasAnyColumn(headers, ['author l-f', 'bookshelves'])) {
    return { confidence: 0.85, reason: 'Goodreads rating + shelf columns' }
  }
  return { confidence: 0 }
}

function cleanIsbn(value) {
  const s = String(value || '').replace(/[^0-9Xx]/g, '')
  return s.length >= 10 ? s : null
}

export function parse(files) {
  const out = []
  for (const file of files) {
    const { headers, rows } = parseCsvObjects(file.text)
    const idx = columnIndex(headers)
    for (const row of rows) {
      const title = pick(row, ['Title'], idx)
      if (!title) continue
      const author = pick(row, ['Author', 'Author l-f'], idx)
      const extra = splitPeople(pick(row, ['Additional Authors'], idx))
      const shelf = pick(row, ['Exclusive Shelf'], idx).toLowerCase()
      const shelves = pick(row, ['Bookshelves'], idx).split(',').map((s) => s.trim()).filter(Boolean)
      const rating = parseRating(pick(row, ['My Rating'], idx))
      const dateRead = parseDate(pick(row, ['Date Read', 'Last Date Read'], idx))
      const dateAdded = parseDate(pick(row, ['Date Added'], idx))
      const readCount = Number(pick(row, ['Read Count'], idx)) || 0
      const binding = pick(row, ['Binding'], idx).toLowerCase()
      const bookId = pick(row, ['Book Id'], idx)
      const isAudio = /audio|audible|cd|mp3/.test(binding) || shelves.some((s) => /audio/i.test(s))

      const base = {
        type: isAudio ? 'audiobook' : 'book',
        title: title.replace(/\s*\([^)]*#[\d.]+\)\s*$/, '').trim(),
        year: parseYear(pick(row, ['Original Publication Year', 'Year Published'], idx)),
        creators: [
          ...(author ? [{ role: 'Author', name: author.includes(',') && !author.includes(' and ') ? author.split(',').reverse().join(' ').trim() : author }] : []),
          ...extra.map((name) => ({ role: 'Contributor', name })),
        ],
        isbn: cleanIsbn(pick(row, ['ISBN13', 'ISBN'], idx)),
        pages: Number(pick(row, ['Number of Pages'], idx)) || null,
        external_rating: Number(pick(row, ['Average Rating'], idx)) * 2 || null,
        metadata: {
          goodreads_id: bookId || null,
          goodreads_url: bookId ? `https://www.goodreads.com/book/show/${bookId}` : null,
          publisher: pick(row, ['Publisher'], idx) || null,
          series: (title.match(/\(([^)]*#[\d.]+)\)/) || [])[1] || null,
          binding: pick(row, ['Binding'], idx) || null,
        },
      }
      const review = pick(row, ['My Review'], idx) || null
      const notes = pick(row, ['Private Notes'], idx) || null
      const tags = shelves.filter((s) => !['read', 'to-read', 'currently-reading'].includes(s))

      if (shelf === 'to-read' || shelf === 'to read') {
        out.push(record({
          ...base,
          kind: 'rec',
          recommender: 'Goodreads to-read',
          note: notes || review,
          source_url: base.metadata.goodreads_url,
          added_at: dateAdded,
          external_key: keyFor('goodreads', 'toread', [bookId || normaliseTitle(title)]),
        }))
        continue
      }

      const status = shelf === 'currently-reading' ? 'in_progress'
        : /abandon|did-not-finish|dnf|unfinished/.test(shelf) ? 'abandoned'
        : 'completed'

      out.push(record({
        ...base,
        kind: 'entry',
        status,
        rating,
        review,
        notes,
        tags,
        consumed_on: status === 'completed' ? dateRead || null : null,
        is_repeat: readCount > 1,
        progress: readCount > 1 ? `Read ${readCount}×` : null,
        external_key: keyFor('goodreads', 'shelf', [bookId || normaliseTitle(title)]),
      }))
    }
  }
  return out
}
