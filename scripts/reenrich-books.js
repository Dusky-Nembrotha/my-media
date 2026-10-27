/*
 * Re-fetch book metadata in English.
 *
 * Open Library describes a *work* — every edition in every language at once —
 * so for a while covers and opening lines were taken from whichever edition
 * sorted first. That is how an English novel ended up with a Turkish cover and
 * a Dutch synopsis.
 *
 * The provider now asks for English editions specifically. This clears the
 * fields that came from the wrong edition so the normal enrichment pass fills
 * them again; nothing you logged or rated is touched.
 *
 *   node scripts/reenrich-books.js            # just say what would change
 *   node scripts/reenrich-books.js --apply
 */
import { all, run, DB_PATH } from '../server/lib/db.js'

const apply = process.argv.includes('--apply')
const everything = process.argv.includes('--all')

/*
 * A cover you chose by hand is never touched. The whole point of the picker is
 * that your choice outranks anything a provider would pick, and a maintenance
 * pass that quietly overrides it is worse than the problem it fixes.
 */
const targets = all(
  `SELECT id, title, language, poster_url
     FROM works
    WHERE type IN ('book', 'audiobook')
      AND ifnull(json_extract(metadata, '$.artwork.chosen'), 0) <> 1
      ${everything ? '' : "AND (language IS NULL OR language <> 'eng')"}
    ORDER BY title`,
)

const chosen = all(
  `SELECT count(*) c FROM works
     WHERE type IN ('book', 'audiobook')
       AND json_extract(metadata, '$.artwork.chosen') = 1`,
)[0]?.c ?? 0

console.log(`\n  ${DB_PATH}`)
console.log(`  ${targets.length} book${targets.length === 1 ? '' : 's'} to re-fetch`)
if (chosen) console.log(`  ${chosen} with a hand-picked cover, left alone`)
console.log('')
for (const t of targets) {
  console.log(`   ${t.language || '??'}  ${t.title}`)
}

if (!apply) {
  console.log('\n  Nothing changed. Re-run with --apply to clear these and re-fetch.\n')
  process.exit(0)
}

for (const t of targets) {
  run(
    `UPDATE works
        SET poster_url = NULL, backdrop_url = NULL, overview = NULL, language = NULL,
            enriched_at = NULL, updated_at = datetime('now')
      WHERE id = ?`,
    t.id,
  )
}

console.log(`\n  Cleared ${targets.length}. Restart Shelved — it re-fetches anything`)
console.log('  missing a cover on startup.\n')
