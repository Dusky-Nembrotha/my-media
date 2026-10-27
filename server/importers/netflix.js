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
  // The full privacy-request export, recognised by its columns rather than its
  // name — people rename downloads, and phones sometimes strip the extension.
  if (headers && hasColumns(headers, ['start time', 'title']) && hasColumns(headers, ['profile name'])) {
    return { confidence: 0.9, reason: 'Netflix viewing activity columns' }
  }
  if (headers && hasColumns(headers, ['start time', 'title', 'supplemental video type'])) {
    return { confidence: 0.85, reason: 'Netflix viewing activity columns' }
  }
  if (headers && headers.length === 2 && hasColumns(headers, ['title', 'date'])) {
    return { confidence: 0.55, reason: 'two-column Title + Date file' }
  }
  return { confidence: 0 }
}

/*
 * Episode detail Netflix puts after the show name. "Season 3" is the common
 * one and parseEpisodeTitle already handles it, but plenty of series — reality
 * and limited runs especially — use one of these instead, and a title ending
 * in one of them is an episode however the rest of the row reads.
 */
/* Tails that mean "this is an episode" and are never a film's subtitle. */
const EPISODE_TAIL = /^(?:episode|ep\.?\s*\d|chapter|volume|vol\.?\s*\d|series\s*\d|season|staffel|limited series|miniseries)\b/i

/*
 * "Part One" is used by docuseries *and* by film sequels — "aka Charlie Sheen:
 * Part One" against "Harry Potter and the Deathly Hallows: Part 1". The title
 * alone cannot separate those, so they are passed to the metadata lookup to
 * settle rather than guessed here.
 */
const AMBIGUOUS_TAIL = /^(?:part|pt\.?|book|finale|special)\b/i

/**
 * Netflix's export carries no type column, so whether a row is a film or one
 * episode of a show has to be read off the title. Two signals do it:
 *
 *  1. The text after the show name looks like episode detail.
 *  2. The same prefix appears across several rows. Netflix repeats the show
 *     name on every episode, so a prefix seen three times or more is a series
 *     whatever its episodes happen to be called.
 *
 * Getting this wrong is expensive — it used to file one *film* per episode,
 * so a season of television arrived as thirteen separate films.
 */
function splitTitle(raw) {
  const i = raw.indexOf(': ')
  if (i <= 0) return null
  return { show: raw.slice(0, i).trim(), tail: raw.slice(i + 2).trim() }
}

function showCounts(rawTitles) {
  const counts = new Map()
  for (const raw of rawTitles) {
    const split = splitTitle(raw)
    if (!split) continue
    const key = normaliseTitle(split.show)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

export function parse(files) {
  const episodeRows = []
  const films = []

  // Read every row first: deciding film-or-episode needs the whole file.
  const allRows = []
  for (const file of files) {
    const { headers, rows } = parseCsvObjects(file.text)
    const idx = columnIndex(headers)
    for (const row of rows) {
      const raw = pick(row, ['Title'], idx)
      if (!raw) continue
      allRows.push({ raw, date: parseDate(pick(row, ['Date', 'Start Time'], idx)) })
    }
  }

  const counts = showCounts(allRows.map((r) => r.raw))

  for (const { raw, date } of allRows) {
    const parsed = parseEpisodeTitle(raw)
    if (parsed.season != null) {
      episodeRows.push({
        type: 'tv',
        title: parsed.show,
        season: parsed.season,
        consumed_on: date,
        metadata: { source: 'netflix' },
      })
      continue
    }

    const split = splitTitle(raw)
    const repeated = split ? (counts.get(normaliseTitle(split.show)) || 0) >= 3 : false
    if (split && (EPISODE_TAIL.test(split.tail) || repeated)) {
      // Season unknown: everything lands under one entry for the show, which
      // is the honest reading of what the export actually says.
      episodeRows.push({
        type: 'tv',
        title: split.show,
        season: null,
        consumed_on: date,
        metadata: { source: 'netflix' },
      })
      continue
    }

    films.push(record({
      type: 'film',
      title: raw,
      consumed_on: date,
      metadata: {
        source: 'netflix',
        // No season marker and no repeats: probably a film, but the export
        // never actually said so, so let the metadata lookup have the final
        // word. Ambiguous tails get the show name to try as well.
        screen_type_unknown: true,
        ...(split && AMBIGUOUS_TAIL.test(split.tail) ? { show_candidate: split.show } : {}),
      },
      external_key: keyFor('netflix', 'film', [normaliseTitle(raw), date || '']),
    }))
  }

  return [...films, ...rollUpEpisodes(episodeRows, { source: 'netflix' })]
}
