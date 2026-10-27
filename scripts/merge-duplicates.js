/*
 * Merge titles that are the same book recorded twice.
 *
 * Publishers append series notes to titles — "Gardens of the Moon" and
 * "Gardens of the Moon : (Malazan Book of the Fallen 1)" — and until the title
 * normaliser learned to ignore those, each arrival created a second record.
 * The result is the same novel appearing twice on a page, once from the series
 * row and once from "more like this", with the ratings split between them.
 *
 * Entries, list memberships and recommendations all move to the surviving
 * record, and the better metadata of the two is kept. Nothing is discarded.
 *
 *   node scripts/merge-duplicates.js
 *   node scripts/merge-duplicates.js --apply
 */
import { all, get, run } from '../server/lib/db.js'
import { normaliseTitle } from '../server/lib/util.js'

const apply = process.argv.includes('--apply')

const works = all(`
  SELECT w.id, w.type, w.title, w.year, w.creators, w.poster_url, w.overview,
         w.isbn, w.olid, w.tmdb_id, w.pages, w.external_rating,
         (SELECT count(*) FROM entries e WHERE e.work_id = w.id) entries,
         (SELECT max(e.rating) FROM entries e WHERE e.work_id = w.id) rating
    FROM works w ORDER BY w.id`)

const groups = new Map()
for (const w of works) {
  const key = `${w.type}|${normaliseTitle(w.title)}`
  ;(groups.get(key) || groups.set(key, []).get(key)).push(w)
}

const sameHand = (a, b) => {
  const names = (w) => {
    try { return JSON.parse(w.creators || '[]').map((c) => String(c.name).toLowerCase()) } catch { return [] }
  }
  const x = names(a)
  const y = names(b)
  if (!x.length || !y.length) return true
  return x.some((p) => y.some((q) => p === q || p.split(/\s+/).pop() === q.split(/\s+/).pop()))
}

const duplicates = [...groups.values()]
  .filter((g) => g.length > 1)
  .filter((g) => g.every((w) => sameHand(g[0], w)))

if (!duplicates.length) {
  console.log('\n  No duplicate titles found.\n')
  process.exit(0)
}

console.log(`\n  ${duplicates.length} title${duplicates.length === 1 ? '' : 's'} recorded more than once:\n`)
for (const group of duplicates) {
  // Keep the one with the most logged against it; break ties on richer metadata.
  const score = (w) => (w.entries * 10) + (w.poster_url ? 2 : 0) + (w.overview ? 2 : 0) + (w.rating != null ? 3 : 0)
  group.sort((a, b) => score(b) - score(a))
  const [keep, ...drop] = group
  console.log(`   keep #${keep.id} ${keep.title}`)
  for (const d of drop) console.log(`   drop #${d.id} ${d.title}  (${d.entries} entries move across)`)
}

if (!apply) {
  console.log('\n  Nothing changed. Re-run with --apply.\n')
  process.exit(0)
}

let merged = 0
let moved = 0
for (const group of duplicates) {
  const score = (w) => (w.entries * 10) + (w.poster_url ? 2 : 0) + (w.overview ? 2 : 0) + (w.rating != null ? 3 : 0)
  group.sort((a, b) => score(b) - score(a))
  const [keep, ...drop] = group

  for (const d of drop) {
    run('UPDATE entries SET work_id = ? WHERE work_id = ?', keep.id, d.id)
    run('UPDATE recs SET work_id = ? WHERE work_id = ?', keep.id, d.id)
    run('UPDATE list_items SET work_id = ? WHERE work_id = ?', keep.id, d.id)
    moved += d.entries

    // Take anything the survivor is missing.
    const patch = {}
    for (const field of ['poster_url', 'backdrop_url', 'overview', 'isbn', 'olid', 'tmdb_id', 'pages', 'external_rating', 'year']) {
      const current = get(`SELECT ${field} AS v FROM works WHERE id = ?`, keep.id)?.v
      const theirs = get(`SELECT ${field} AS v FROM works WHERE id = ?`, d.id)?.v
      if ((current == null || current === '') && theirs != null && theirs !== '') patch[field] = theirs
    }
    const keys = Object.keys(patch)
    if (keys.length) {
      run(`UPDATE works SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), keep.id)
    }

    run('DELETE FROM works WHERE id = ?', d.id)
  }
  merged++
}

console.log(`\n  Merged ${merged} titles, moving ${moved} entries onto the survivors.\n`)
