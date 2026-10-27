/*
 * Strip markup out of synopses already stored.
 *
 * Open Library returns publisher descriptions with HTML in them, which was
 * being shown as literal "<b>" and "<br />" on the page. New lookups are
 * cleaned as they arrive; this fixes what is already here.
 *
 *   node scripts/clean-synopses.js            # report
 *   node scripts/clean-synopses.js --apply
 */
import { all, run } from '../server/lib/db.js'
import { plainText } from '../server/lib/util.js'

const apply = process.argv.includes('--apply')
const rows = all("SELECT id, title, overview FROM works WHERE overview LIKE '%<%>%'")

console.log(`\n  ${rows.length} synopses contain markup\n`)
for (const r of rows.slice(0, 8)) console.log(`   ${r.title}`)
if (rows.length > 8) console.log(`   …and ${rows.length - 8} more`)

if (!apply) {
  console.log('\n  Nothing changed. Re-run with --apply.\n')
  process.exit(0)
}

let fixed = 0
for (const r of rows) {
  const clean = plainText(r.overview)
  if (!clean || clean === r.overview) continue
  run("UPDATE works SET overview = ?, updated_at = datetime('now') WHERE id = ?", clean, r.id)
  fixed++
}
console.log(`\n  Cleaned ${fixed}.\n`)
