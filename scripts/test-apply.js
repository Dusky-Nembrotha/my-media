import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { explode, detect, parseWith } from '../server/importers/index.js'
import { applyRecords } from '../server/importers/apply.js'
import { all, get } from '../server/lib/db.js'

const root = join(import.meta.dirname, '..', 'samples')
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

const groups = [
  ['letterboxd', walk(join(root, 'letterboxd'))],
  ['goodreads', [join(root, 'goodreads_library_export.csv')]],
  ['audible', [join(root, 'Audible.Library.csv')]],
  ['imdb', [join(root, 'imdb_ratings.csv')]],
  ['trakt', [join(root, 'trakt_watched_shows.json')]],
  ['spotify', walk(join(root, 'spotify'))],
  ['netflix', [join(root, 'NetflixViewingHistory.csv')]],
]

for (const pass of [1, 2]) {
  console.log(`\n######## PASS ${pass} (pass 2 must add nothing: imports are idempotent)`)
  for (const [name, paths] of groups) {
    const files = paths.flatMap((p) => explode({ filename: relative(root, p), buffer: readFileSync(p) }))
    const top = detect(files)[0]
    const { records } = parseWith(top.id, files)
    const s = applyRecords(records, { source: top.id, filename: name, enrich: false })
    console.log(`${name.padEnd(11)} works+${String(s.worksAdded).padEnd(4)} entries+${String(s.entriesAdded).padEnd(4)} upd ${String(s.entriesUpdated).padEnd(4)} skip ${String(s.entriesSkipped).padEnd(4)} recs+${String(s.recsAdded).padEnd(3)} lists ${s.listsTouched.join('/') || '-'}${s.errors.length ? ' ERRORS ' + s.errors.slice(0, 2).join('; ') : ''}`)
  }
}

console.log('\n--- totals ---')
console.log('works  ', get('SELECT count(*) c FROM works').c, all('SELECT type, count(*) c FROM works GROUP BY type ORDER BY c DESC').map((r) => `${r.type}:${r.c}`).join(' '))
console.log('entries', get('SELECT count(*) c FROM entries').c, '| rated', get('SELECT count(*) c FROM entries WHERE rating IS NOT NULL').c)
console.log('recs   ', get('SELECT count(*) c FROM recs').c, '| lists', get('SELECT count(*) c FROM lists').c)
console.log('\nduplicate check (same work logged twice on the same day):')
console.log(all(`SELECT w.title, e.consumed_on, count(*) c FROM entries e JOIN works w ON w.id = e.work_id
  GROUP BY e.work_id, e.consumed_on HAVING c > 1 AND e.consumed_on IS NOT NULL LIMIT 5`))
console.log('\nmulti-entry works (legitimate rewatches/seasons):')
console.log(all(`SELECT w.title, w.type, count(*) c FROM entries e JOIN works w ON w.id = e.work_id
  GROUP BY e.work_id HAVING c > 1 ORDER BY c DESC LIMIT 6`))
console.log('\nsample of logged films:')
console.log(all(`SELECT w.title, w.year, e.rating, e.consumed_on, substr(ifnull(e.review,''),0,30) rev FROM entries e
  JOIN works w ON w.id = e.work_id WHERE w.type='film' ORDER BY e.consumed_on DESC LIMIT 6`))
