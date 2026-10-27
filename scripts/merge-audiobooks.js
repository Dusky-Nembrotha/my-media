/*
 * Fold the audiobook library into books.
 *
 * A book is a book; whether you read it or listened to it is a property of
 * *your* reading of it, not of the book. So audiobook works become books, and
 * the entries against them are marked as having been listened to.
 *
 * Where you own both — the same title catalogued twice, once each way — the
 * two are merged into one title carrying both entries, so the work page shows
 * "read in 2019, listened to in 2023" rather than two half-empty pages.
 *
 * Nothing is thrown away: every entry, rating, review and date is carried
 * across. Run without --apply first; it prints exactly what it would do.
 *
 *   node scripts/merge-audiobooks.js
 *   node scripts/merge-audiobooks.js --apply
 */
import { all, get, run } from '../server/lib/db.js'
import { normaliseTitle } from '../server/lib/util.js'

const apply = process.argv.includes('--apply')

const audiobooks = all("SELECT id, title, creators, year FROM works WHERE type = 'audiobook' ORDER BY title")
if (!audiobooks.length) {
  console.log('\n  No audiobooks to merge. Nothing to do.\n')
  process.exit(0)
}

const books = all("SELECT id, title, creators FROM works WHERE type = 'book'")
const byTitle = new Map(books.map((b) => [normaliseTitle(b.title), b]))

const merges = []
const converts = []
for (const a of audiobooks) {
  const twin = byTitle.get(normaliseTitle(a.title))
  if (twin) merges.push({ audiobook: a, book: twin })
  else converts.push(a)
}

console.log(`\n  ${audiobooks.length} audiobooks`)
console.log(`  ${converts.length} become books in their own right`)
console.log(`  ${merges.length} merge into a book you already have:\n`)
for (const m of merges) console.log(`     ${m.audiobook.title}  →  #${m.book.id} ${m.book.title}`)

const entryCount = get("SELECT count(*) c FROM entries e JOIN works w ON w.id = e.work_id WHERE w.type = 'audiobook'")?.c ?? 0
console.log(`\n  ${entryCount} entries will be marked as listened to.`)

if (!apply) {
  console.log('\n  Nothing changed. Re-run with --apply.\n')
  process.exit(0)
}

let moved = 0
let removed = 0

// Every entry against an audiobook was, by definition, listened to.
run(`UPDATE entries SET format = 'audiobook'
      WHERE format IS NULL
        AND work_id IN (SELECT id FROM works WHERE type = 'audiobook')`)

// Entries against books were, by definition, read.
run(`UPDATE entries SET format = 'book'
      WHERE format IS NULL
        AND work_id IN (SELECT id FROM works WHERE type = 'book')`)

for (const { audiobook, book } of merges) {
  // Carry the entries across, then anything else pointing at the old title.
  run('UPDATE entries SET work_id = ? WHERE work_id = ?', book.id, audiobook.id)
  run('UPDATE recs SET work_id = ? WHERE work_id = ?', book.id, audiobook.id)
  run('UPDATE list_items SET work_id = ? WHERE work_id = ?', book.id, audiobook.id)
  moved++

  // Keep whichever cover and synopsis is actually there.
  const a = get('SELECT * FROM works WHERE id = ?', audiobook.id)
  const b = get('SELECT * FROM works WHERE id = ?', book.id)
  const patch = {}
  for (const field of ['poster_url', 'backdrop_url', 'overview', 'isbn', 'olid', 'pages', 'external_rating']) {
    if (!b[field] && a[field]) patch[field] = a[field]
  }
  const keys = Object.keys(patch)
  if (keys.length) {
    run(`UPDATE works SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), book.id)
  }

  run('DELETE FROM works WHERE id = ?', audiobook.id)
  removed++
}

const converted = run("UPDATE works SET type = 'book', updated_at = datetime('now') WHERE type = 'audiobook'")
run("UPDATE recs SET type = 'book' WHERE type = 'audiobook'")

console.log(`\n  Merged ${moved} into existing books (${removed} duplicate titles removed).`)
console.log(`  Converted ${converted.changes} audiobooks into books.`)
console.log('  Every entry now says whether it was read or listened to.\n')
