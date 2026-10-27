/*
 * One-off: bring in an audiobook library from a folder of folders.
 *
 * Folders are named "Author - Title", with the subtitle usually run straight
 * onto the title ("The Seabird's Cry The Lives and Loves of Puffins…"). So the
 * title is offered to Open Library whole, and then progressively trimmed from
 * the right until something matches — which is what separates the title from
 * the subtitle without having to guess where the break is.
 *
 * Nothing is written without --apply, and the dry run prints what each folder
 * resolved to so a bad match can be spotted before it lands.
 *
 *   node scripts/import-audiobook-folders.js "/path/to/Audiobooks"
 *   node scripts/import-audiobook-folders.js "/path/to/Audiobooks" --apply
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ol, itunes, chooseBest } from '../server/providers/index.js'
import { applyRecords } from '../server/importers/apply.js'
import { run } from '../server/lib/db.js'
import { record, keyFor } from '../server/importers/shared.js'
import { normaliseTitle } from '../server/lib/util.js'

const dir = process.argv[2]
const apply = process.argv.includes('--apply')
if (!dir) {
  console.error('\n  Give me the folder: node scripts/import-audiobook-folders.js "/path/to/Audiobooks"\n')
  process.exit(1)
}

/** "Author - Title" → the two halves, with the odd shape allowed for. */
function split(name) {
  let s = name.trim()

  // Trailing noise: "- audio book", "(Unabridged)", "[1939]".
  s = s.replace(/\s*[-–]\s*audio\s*books?\s*$/i, '')
  s = s.replace(/\s*\((?:un)?abridged\)\s*$/i, '')
  const yearMatch = s.match(/\s*\[(\d{4})\]\s*$/)
  const year = yearMatch ? Number(yearMatch[1]) : null
  if (yearMatch) s = s.slice(0, yearMatch.index)

  // "Title - Author" where the author is clearly last ("… - Antoine de Saint-Exupéry").
  const parts = s.split(/\s+[-–]\s+/)
  if (parts.length === 1) return { author: null, title: parts[0].trim(), year }

  // Normally the author comes first; a trailing "Narrated by …" is not a title.
  const head = parts[0].trim()
  const tail = parts.slice(1).join(' - ').trim().replace(/\s*narrated by .*$/i, '').trim()

  // A few folders are the other way round ("Wind, Sand and Stars - Antoine de
  // Saint-Exupéry"). Rather than guess from the shape, both readings are
  // offered and whichever the catalogues recognise wins.
  return { author: head, title: tail, year, alternate: { author: tail, title: head, year } }
}

/** Trim the title from the right until a provider recognises it. */
async function resolveOne({ author, title, year }) {
  const words = title.split(/\s+/)
  const tried = new Set()

  for (let n = words.length; n >= Math.min(2, words.length); n--) {
    const attempt = words.slice(0, n).join(' ')
    if (tried.has(attempt.toLowerCase())) continue
    tried.add(attempt.toLowerCase())

    const seed = { title: attempt, year, creators: author ? [{ role: 'Author', name: author }] : [] }
    const hits = await ol.search(attempt, { limit: 6, type: 'audiobook', author: author || undefined })
    const best = chooseBest(hits, seed)
    if (best) return { ...best, matchedOn: attempt }
  }

  // Apple's audiobook catalogue as a second opinion.
  const term = [title, author].filter(Boolean).join(' ')
  const alt = chooseBest(await itunes.search('audiobook', term, 6), { title, year, creators: [] })
  if (alt) return { ...alt, matchedOn: 'Apple' }
  return null
}

async function resolve(parsed) {
  const first = await resolveOne(parsed)
  if (first) return first
  if (!parsed.alternate) return null
  const swapped = await resolveOne(parsed.alternate)
  return swapped ? { ...swapped, swapped: true } : null
}

const folders = readdirSync(dir)
  .filter((n) => !n.startsWith('.') && !n.startsWith('$') && n !== 'LOST.DIR')
  .filter((n) => { try { return statSync(join(dir, n)).isDirectory() } catch { return false } })
  .sort()

console.log(`\n  ${folders.length} folders in ${dir}\n`)

const records = []
const unmatched = []

for (const name of folders) {
  const parsed = split(name)
  const found = await resolve(parsed)

  if (!found) {
    unmatched.push({ name, parsed })
    // Still log it — a book you own belongs in the library even if the
    // metadata sources have never heard of it.
    records.push(record({
      type: 'audiobook',
      title: parsed.title,
      year: parsed.year,
      creators: parsed.author ? [{ role: 'Author', name: parsed.author }] : [],
      status: 'completed',
      consumed_on: null,
      metadata: { source: 'folder-scan', folder: name },
      external_key: keyFor('folder', 'audiobook', [normaliseTitle(parsed.title)]),
    }))
    console.log(`   ?  ${parsed.title}${parsed.author ? ` — ${parsed.author}` : ''}`)
    continue
  }

  records.push(record({
    type: 'audiobook',
    title: found.title,
    year: found.year ?? parsed.year,
    creators: found.creators?.length ? found.creators : (parsed.author ? [{ role: 'Author', name: parsed.author }] : []),
    status: 'completed',
    consumed_on: null,
    poster_url: found.poster_url || null,
    overview: found.overview || null,
    genres: found.genres || [],
    pages: found.pages ?? null,
    isbn: found.isbn ?? null,
    olid: found.olid ?? null,
    external_rating: found.external_rating ?? null,
    metadata: { ...(found.metadata || {}), source: 'folder-scan', folder: name },
    external_key: keyFor('folder', 'audiobook', [normaliseTitle(found.title)]),
  }))
  const note = [
    found.matchedOn !== found.title ? `matched on "${found.matchedOn}"` : null,
    found.swapped ? 'author and title were the other way round' : null,
  ].filter(Boolean).join('; ')
  console.log(`   ✓  ${found.title} — ${(found.creators || [])[0]?.name?.trim() || parsed.author || '?'}${note ? `  (${note})` : ''}`)
}

console.log(`\n  ${records.length - unmatched.length} matched, ${unmatched.length} logged by folder name alone.`)

if (!apply) {
  console.log('\n  Nothing written. Re-run with --apply.\n')
  process.exit(0)
}

/*
 * Recorded as an import run so it shows up in the history with an Undo button.
 * Owning an audiobook is being read here as having listened to it, which is
 * the common case but not a certainty — so it needs to be easy to take back.
 */
const started = run(
  "INSERT INTO import_runs (user_id, source, filename, status) VALUES (1, 'folder-scan', ?, 'running')",
  dir,
)
const runId = Number(started.lastInsertRowid)

const summary = applyRecords(records, { source: 'folder-scan', filename: dir, enrich: true })

run(
  `UPDATE import_runs SET status = 'done', works_added = ?, entries_added = ?, entries_skipped = ?,
        detail = ?, finished_at = datetime('now')
    WHERE id = ?`,
  summary.worksAdded, summary.entriesAdded, summary.entriesSkipped,
  JSON.stringify({ folders: folders.length, matched: records.length - unmatched.length, unmatched: unmatched.map((u) => u.name) }),
  runId,
)

console.log(`\n  Added ${summary.entriesAdded} entries and ${summary.worksAdded} titles`
  + `${summary.entriesSkipped ? `, skipped ${summary.entriesSkipped} already present` : ''}.`)
console.log('  Logged as heard, with no date. Import → history → Undo takes it all back.\n')
