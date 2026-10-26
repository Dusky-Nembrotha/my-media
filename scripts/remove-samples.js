/*
 * Removes the bundled sample library, leaving everything you imported yourself.
 *
 *   node scripts/remove-samples.js              # show what would go (default)
 *   node scripts/remove-samples.js --confirm    # actually do it
 *
 * It works from a cutoff: your first real import. Anything logged before that
 * came from the samples. A timestamped backup is taken before any deletion.
 */
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { all, get, run, db, DATA_DIR } from '../server/lib/db.js'

const confirm = process.argv.includes('--confirm')
const explicitCut = (process.argv.find((a) => a.startsWith('--before=')) || '').split('=')[1]

/*
 * The samples were loaded in one go before you imported anything of your own,
 * so the first import that added rows under a filename other than the bundled
 * ones marks the boundary.
 */
const SAMPLE_FILENAMES = ['bundled sample', 'goodreads_library_export.csv', 'letterboxd', 'audible', 'imdb', 'trakt', 'spotify', 'netflix']

function findCutoff() {
  if (explicitCut) return explicitCut
  const real = get(`
    SELECT min(started_at) t FROM import_runs
     WHERE works_added > 0
       AND filename NOT IN (${SAMPLE_FILENAMES.map(() => '?').join(',')})`, ...SAMPLE_FILENAMES)
  if (real?.t) return real.t
  const firstReal = get("SELECT min(created_at) t FROM entries WHERE source NOT IN ('manual')")
  return firstReal?.t || '1970-01-01'
}

const cutoff = findCutoff()

const doomed = {
  entries: get('SELECT count(*) c FROM entries WHERE created_at < ?', cutoff).c,
  recs: get('SELECT count(*) c FROM recs WHERE added_at < date(?) OR title = ?', cutoff, 'Smoke Test Film').c,
  lists: get('SELECT count(*) c FROM lists WHERE created_at < ?', cutoff).c,
  runs: get('SELECT count(*) c FROM import_runs WHERE started_at < ?', cutoff).c,
}
const keeping = {
  entries: get('SELECT count(*) c FROM entries WHERE created_at >= ?', cutoff).c,
}

console.log(`\nCutoff: ${cutoff}  (anything logged before this is sample data)\n`)
console.log('  would remove:')
console.log(`    ${String(doomed.entries).padStart(5)} log entries`)
console.log(`    ${String(doomed.recs).padStart(5)} "to check out" items`)
console.log(`    ${String(doomed.lists).padStart(5)} lists`)
console.log(`    ${String(doomed.runs).padStart(5)} import-history rows`)
console.log('\n  by source:', all(
  'SELECT source, count(*) c FROM entries WHERE created_at < ? GROUP BY source ORDER BY c DESC', cutoff,
).map((r) => `${r.source} ${r.c}`).join(' · ') || 'nothing')
console.log(`\n  would keep: ${keeping.entries} log entries`)
console.log('  ', all(
  'SELECT source, count(*) c FROM entries WHERE created_at >= ? GROUP BY source ORDER BY c DESC', cutoff,
).map((r) => `${r.source} ${r.c}`).join(' · ') || 'nothing')

const manual = get("SELECT count(*) c FROM entries WHERE created_at < ? AND source = 'manual'", cutoff).c
if (manual) console.log(`\n  ⚠ ${manual} of those were logged by hand, not imported. Use --before=<timestamp> to move the cutoff.`)

if (!confirm) {
  console.log('\nNothing changed. Re-run with --confirm to go ahead.\n')
  process.exit(0)
}

const backup = join(DATA_DIR, `mymedia-before-sample-removal-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`)
copyFileSync(join(DATA_DIR, 'mymedia.db'), backup)
console.log(`\nBackup: ${backup}`)

db.exec('BEGIN')
try {
  run('DELETE FROM entries WHERE created_at < ?', cutoff)
  run('DELETE FROM recs WHERE added_at < date(?) OR title = ?', cutoff, 'Smoke Test Film')
  run('DELETE FROM list_items WHERE list_id IN (SELECT id FROM lists WHERE created_at < ?)', cutoff)
  run('DELETE FROM lists WHERE created_at < ?', cutoff)
  run('DELETE FROM import_runs WHERE started_at < ?', cutoff)
  // Anything with nothing left pointing at it.
  run(`DELETE FROM works
        WHERE id NOT IN (SELECT work_id FROM entries)
          AND id NOT IN (SELECT work_id FROM list_items)
          AND id NOT IN (SELECT ifnull(work_id, -1) FROM recs)`)
  run('DELETE FROM rec_cache')   // engine picks were built from the sample taste
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('\nFailed, nothing changed:', err.message)
  process.exit(1)
}

console.log('\nDone. Your library now holds:')
console.log(' ', all('SELECT type, count(*) c FROM works GROUP BY type ORDER BY c DESC').map((r) => `${r.type} ${r.c}`).join(' · '))
console.log('  entries:', get('SELECT count(*) c FROM entries').c, '· to check out:', get('SELECT count(*) c FROM recs').c)
console.log('\nWorth re-importing your exports afterwards: a few of your films may have')
console.log('been skipped as duplicates of sample entries, and re-importing restores them.\n')
