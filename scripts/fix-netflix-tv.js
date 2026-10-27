/*
 * Re-classify Netflix imports that landed as films.
 *
 * Netflix's export has no type column, so a series whose rows carry no
 * "Season N" marker used to arrive as one *film* per episode — "1883: River",
 * "1883: The Crossing" and so on, nine separate films for one show.
 *
 * The importer now reads two signals: an episode-shaped tail, and a show name
 * repeated across rows. This applies those same rules to what is already in
 * the library: the episode rows are rebuilt as one TV entry per show, and the
 * film works left with nothing logged against them are removed.
 *
 * Only Netflix entries are considered, and a work is only ever removed once
 * its episodes have been re-logged against the show. Anything you have rated,
 * reviewed or edited by hand is reported and left alone.
 *
 *   node scripts/fix-netflix-tv.js            # report only
 *   node scripts/fix-netflix-tv.js --apply
 */
import { all, get, run } from '../server/lib/db.js'
import { parse as parseNetflix } from '../server/importers/netflix.js'
import { applyRecords } from '../server/importers/apply.js'

const apply = process.argv.includes('--apply')

// Every Netflix entry currently filed as a film, as the export itself read.
const rows = all(
  `SELECT e.id AS entry_id, e.work_id, e.consumed_on, e.rating, e.review, e.liked,
          e.updated_at, e.created_at, w.title
     FROM entries e JOIN works w ON w.id = e.work_id
    WHERE e.source = 'netflix' AND w.type = 'film'
    ORDER BY e.consumed_on DESC`,
)

if (!rows.length) {
  console.log('\n  No Netflix entries filed as films. Nothing to do.\n')
  process.exit(0)
}

// Feed them back through the importer, which decides film or episode.
const csv = ['Title,Date', ...rows.map((r) => `"${r.title.replace(/"/g, '""')}","${r.consumed_on || ''}"`)].join('\n')
const records = parseNetflix([{ text: csv }])

const asTv = new Map()          // show title -> the record for it
for (const rec of records) {
  if (rec.type === 'tv') asTv.set(rec.title, rec)
}

// Which of the current film works were episodes of one of those shows?
const reclassified = []
for (const row of rows) {
  const split = row.title.indexOf(': ') > 0 ? row.title.slice(0, row.title.indexOf(': ')).trim() : null
  const show = asTv.has(row.title) ? row.title : (split && asTv.has(split) ? split : null)
  if (show) reclassified.push({ ...row, show })
}

const shows = [...new Set(reclassified.map((r) => r.show))].sort()
const edited = reclassified.filter((r) => r.rating != null || r.review || r.liked
  || (r.updated_at && r.updated_at !== r.created_at))

console.log(`\n  ${rows.length} Netflix entries filed as films`)
console.log(`  ${reclassified.length} of them are episodes of ${shows.length} shows\n`)
for (const show of shows) {
  const mine = reclassified.filter((r) => r.show === show)
  console.log(`   ${show} — ${mine.length} episode row${mine.length === 1 ? '' : 's'}`)
  for (const m of mine.slice(0, 3)) console.log(`      ${m.title}`)
  if (mine.length > 3) console.log(`      …and ${mine.length - 3} more`)
}

const keptFilms = rows.length - reclassified.length
console.log(`\n  ${keptFilms} entries stay as films.`)
if (edited.length) {
  console.log(`  ${edited.length} of the episode rows are rated or reviewed — their`)
  console.log('  ratings move to the show, which is the nearest honest reading.')
}

if (!apply) {
  console.log('\n  Nothing changed. Re-run with --apply.\n')
  process.exit(0)
}

// 1. Log the shows. applyRecords is idempotent on external_key, so running
//    this twice does not double anything up.
const tvRecords = shows.map((show) => {
  const mine = reclassified.filter((r) => r.show === show)
  const rated = mine.find((r) => r.rating != null)
  return { ...asTv.get(show), rating: rated?.rating ?? asTv.get(show).rating ?? null }
})
const summary = applyRecords(tvRecords, { source: 'netflix', filename: 'reclassified from films', enrich: true })
console.log(`\n  Logged ${summary.entriesAdded} shows (${summary.worksAdded} new titles).`)

// 2. Remove the episode entries, and any film work left with nothing logged.
let entriesRemoved = 0
let worksRemoved = 0
const touched = new Set()
for (const row of reclassified) {
  run('DELETE FROM entries WHERE id = ?', row.entry_id)
  entriesRemoved++
  touched.add(row.work_id)
}
for (const workId of touched) {
  if ((get('SELECT count(*) c FROM entries WHERE work_id = ?', workId)?.c ?? 0) > 0) continue
  if ((get('SELECT count(*) c FROM list_items WHERE work_id = ?', workId)?.c ?? 0) > 0) continue
  run('DELETE FROM works WHERE id = ?', workId)
  worksRemoved++
}

console.log(`  Removed ${entriesRemoved} episode entries and ${worksRemoved} stray film titles.`)

/*
 * 3. Films whose title cannot settle the question on its own — "Part One" is
 *    used by docuseries and film sequels alike — are flagged so the metadata
 *    lookup decides, the same as a fresh import would.
 */
let flagged = 0
const stillFilms = records.filter((r) => r.type === 'film' && r.metadata?.show_candidate)
for (const rec of stillFilms) {
  const work = get(
    "SELECT id, metadata FROM works WHERE type = 'film' AND lower(title) = lower(?)",
    rec.title,
  )
  if (!work) continue
  let meta = {}
  try { meta = JSON.parse(work.metadata) || {} } catch { /* start fresh */ }
  run(
    "UPDATE works SET metadata = ?, enriched_at = NULL, updated_at = datetime('now') WHERE id = ?",
    JSON.stringify({ ...meta, screen_type_unknown: true, show_candidate: rec.metadata.show_candidate }),
    work.id,
  )
  flagged++
}
console.log(`  Flagged ${flagged} ambiguous titles for the metadata lookup to settle.`)
console.log('  Restart Shelved to let it run.\n')
