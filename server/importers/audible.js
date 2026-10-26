import { parseCsvObjects, columnIndex, pick, hasAnyColumn } from '../lib/csv.js'
import { parseDate, parseRating, parseYear, parseRuntime, splitPeople, normaliseTitle } from '../lib/util.js'
import { record, keyFor } from './shared.js'

export const id = 'audible'
export const label = 'Audible'
export const accepts = ['.csv', '.tsv', '.json']
export const help = 'Audible has no export button, so use Amazon → Account → Request Your Data '
  + '→ "Audible" (you get Audible.Library.csv and Audible.Listening.csv by email), or any CSV with '
  + 'Title / Author / Narrator columns.'

export function detect({ filename, headers }) {
  const name = String(filename || '').toLowerCase()
  if (name.includes('audible')) return { confidence: 0.97, reason: 'Audible data-request filename' }
  if (headers && hasAnyColumn(headers, ['narrator', 'narrators', 'narrated by'])) {
    return { confidence: 0.9, reason: 'Narrator column' }
  }
  if (headers && hasAnyColumn(headers, ['asin']) && hasAnyColumn(headers, ['title'])) {
    return { confidence: 0.6, reason: 'ASIN + Title columns' }
  }
  return { confidence: 0 }
}

export function parse(files) {
  const out = []
  for (const file of files) {
    const { headers, rows } = parseCsvObjects(file.text)
    const idx = columnIndex(headers)
    const isListening = /listening/i.test(file.filename || '')
      || hasAnyColumn(headers, ['listening time', 'total listening time', 'percent complete'])

    for (const row of rows) {
      const title = pick(row, ['Title', 'Book Title', 'product name'], idx)
      if (!title) continue
      const asin = pick(row, ['ASIN', 'Asin', 'product id'], idx) || null
      const narrators = splitPeople(pick(row, ['Narrator', 'Narrators', 'Narrated By'], idx))
      const authors = splitPeople(pick(row, ['Author', 'Authors', 'Written By'], idx))
      const percent = Number(String(pick(row, ['Percent Complete', 'percentage complete'], idx)).replace('%', '')) || null
      const finished = /yes|true|finished|complete/i.test(pick(row, ['Is Finished', 'Finished', 'Status'], idx))
      const dateFinished = parseDate(pick(row, ['Date Finished', 'Last Played', 'Completion Date'], idx))
      const datePurchased = parseDate(pick(row, ['Date Added', 'Purchase Date', 'Order Date', 'DateAdded'], idx))

      const base = {
        type: 'audiobook',
        title: title.replace(/\s*[:(]\s*(Unabridged|Abridged)\s*\)?\s*$/i, '').trim(),
        year: parseYear(pick(row, ['Publication Date', 'Release Date', 'Year'], idx)),
        creators: [
          ...authors.map((name) => ({ role: 'Author', name })),
          ...narrators.map((name) => ({ role: 'Narrator', name })),
        ],
        asin,
        runtime: parseRuntime(pick(row, ['Length', 'Runtime', 'Duration', 'Run Time'], idx)),
        genres: pick(row, ['Category', 'Categories', 'Genre'], idx).split(/[,;|>]/).map((s) => s.trim()).filter(Boolean),
        metadata: {
          audible_asin: asin,
          narrators,
          publisher: pick(row, ['Publisher'], idx) || null,
          series: pick(row, ['Series', 'Series Title'], idx) || null,
          audible_url: asin ? `https://www.audible.co.uk/pd/${asin}` : null,
        },
      }

      const rating = parseRating(pick(row, ['My Rating', 'Overall Rating', 'Rating'], idx))
      const complete = finished || (percent != null && percent >= 95)
      const status = complete ? 'completed' : percent ? 'in_progress' : 'planned'

      if (status === 'planned' && !isListening) {
        // In the library but never started: that is a queue, not a log entry.
        out.push(record({
          ...base,
          kind: 'rec',
          recommender: 'Audible library',
          note: 'In your Audible library, not started',
          source_url: base.metadata.audible_url,
          external_key: keyFor('audible', 'library', [asin || normaliseTitle(title)]),
        }))
        continue
      }

      out.push(record({
        ...base,
        kind: 'entry',
        status,
        rating,
        consumed_on: complete ? dateFinished || datePurchased : null,
        progress: !complete && percent ? `${Math.round(percent)}%` : null,
        review: pick(row, ['My Review', 'Review'], idx) || null,
        external_key: keyFor('audible', 'listen', [asin || normaliseTitle(title)]),
      }))
    }
  }
  return out
}
