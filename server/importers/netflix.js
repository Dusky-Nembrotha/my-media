import { parseCsvObjects, columnIndex, pick, hasColumns } from '../lib/csv.js'
import { parseDate, normaliseTitle } from '../lib/util.js'
import { record, keyFor, parseEpisodeTitle, rollUpEpisodes } from './shared.js'

export const id = 'netflix'
export const label = 'Netflix'
export const accepts = ['.csv']
export const help = 'Netflix → Account → Profile → Viewing activity → Download all. '
  + 'Episodes are grouped per season; Netflix gives no ratings, so entries arrive unrated.'

export function detect({ filename, headers }) {
  const name = String(filename || '').toLowerCase()
  if (name.includes('netflix') || name.includes('viewingactivity')) {
    return { confidence: 0.95, reason: 'Netflix viewing activity filename' }
  }
  if (headers && headers.length === 2 && hasColumns(headers, ['title', 'date'])) {
    return { confidence: 0.55, reason: 'two-column Title + Date file' }
  }
  return { confidence: 0 }
}

export function parse(files) {
  const episodeRows = []
  const films = []
  for (const file of files) {
    const { headers, rows } = parseCsvObjects(file.text)
    const idx = columnIndex(headers)
    for (const row of rows) {
      const raw = pick(row, ['Title'], idx)
      if (!raw) continue
      const date = parseDate(pick(row, ['Date', 'Start Time'], idx))
      const parsed = parseEpisodeTitle(raw)
      if (parsed.season != null) {
        episodeRows.push({
          type: 'tv',
          title: parsed.show,
          season: parsed.season,
          consumed_on: date,
          metadata: { source: 'netflix' },
        })
      } else {
        films.push(record({
          type: 'film',
          title: raw,
          consumed_on: date,
          metadata: { source: 'netflix' },
          external_key: keyFor('netflix', 'film', [normaliseTitle(raw), date || '']),
        }))
      }
    }
  }
  return [...films, ...rollUpEpisodes(episodeRows, { source: 'netflix' })]
}
