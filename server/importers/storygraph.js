import { parseCsvObjects, columnIndex, pick, hasAnyColumn } from '../lib/csv.js'
import { parseDate, parseRating, parseYear, splitPeople, normaliseTitle } from '../lib/util.js'
import { record, keyFor } from './shared.js'

export const id = 'storygraph'
export const label = 'The StoryGraph'
export const accepts = ['.csv']
export const help = 'StoryGraph → Manage Account → Export StoryGraph Data. Moods, pace and '
  + 'content warnings are kept as tags.'

export function detect({ filename, headers }) {
  const name = String(filename || '').toLowerCase()
  if (name.includes('storygraph')) return { confidence: 0.98, reason: 'StoryGraph export filename' }
  if (headers && hasAnyColumn(headers, ['read status']) && hasAnyColumn(headers, ['star rating'])) {
    return { confidence: 0.95, reason: 'Read Status + Star Rating columns' }
  }
  if (headers && hasAnyColumn(headers, ['moods']) && hasAnyColumn(headers, ['pace'])) {
    return { confidence: 0.9, reason: 'StoryGraph mood/pace columns' }
  }
  return { confidence: 0 }
}

export function parse(files) {
  const out = []
  for (const file of files) {
    const { headers, rows } = parseCsvObjects(file.text)
    const idx = columnIndex(headers)
    for (const row of rows) {
      const title = pick(row, ['Title'], idx)
      if (!title) continue
      const format = pick(row, ['Format'], idx).toLowerCase()
      const readStatus = pick(row, ['Read Status'], idx).toLowerCase()
      const uid = pick(row, ['ISBN/UID', 'ISBN', 'UID'], idx)
      const moods = pick(row, ['Moods'], idx).split(',').map((s) => s.trim()).filter(Boolean)
      const pace = pick(row, ['Pace'], idx)
      const tags = [
        ...pick(row, ['Tags'], idx).split(',').map((s) => s.trim()).filter(Boolean),
        ...moods,
        ...(pace ? [`${pace} pace`] : []),
      ]
      const base = {
        type: /audio/.test(format) ? 'audiobook' : 'book',
        title,
        year: parseYear(pick(row, ['Publication Year', 'Original Publication Year'], idx)),
        creators: [
          ...splitPeople(pick(row, ['Authors', 'Author'], idx)).map((name) => ({ role: 'Author', name })),
          ...splitPeople(pick(row, ['Contributors'], idx)).map((name) => ({ role: 'Contributor', name })),
        ],
        isbn: /^\d{9,13}X?$/i.test(uid) ? uid : null,
        pages: Number(pick(row, ['Number of Pages'], idx)) || null,
        external_rating: Number(pick(row, ['Average Rating'], idx)) * 2 || null,
        metadata: { storygraph_uid: uid || null, pace: pace || null, moods },
      }
      const rating = parseRating(pick(row, ['Star Rating'], idx))
      const dateRead = parseDate(pick(row, ['Last Date Read', 'Dates Read'], idx))

      if (readStatus === 'to-read' || readStatus === 'to read') {
        out.push(record({
          ...base,
          kind: 'rec',
          recommender: 'StoryGraph to-read',
          note: pick(row, ['Review'], idx) || null,
          external_key: keyFor('storygraph', 'toread', [uid || normaliseTitle(title)]),
        }))
        continue
      }
      const status = readStatus === 'currently-reading' ? 'in_progress'
        : readStatus === 'did-not-finish' ? 'abandoned' : 'completed'
      out.push(record({
        ...base,
        kind: 'entry',
        status,
        rating,
        review: pick(row, ['Review'], idx) || null,
        tags,
        consumed_on: status === 'completed' ? dateRead : null,
        is_repeat: (Number(pick(row, ['Read Count'], idx)) || 0) > 1,
        external_key: keyFor('storygraph', 'read', [uid || normaliseTitle(title)]),
      }))
    }
  }
  return out
}
