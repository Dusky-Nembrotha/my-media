/*
 * Take a safe copy of the library, now.
 *
 * The app does this for itself once a day while it is running; this is for
 * taking one on demand — before a migration, or before trying something out.
 *
 *   node scripts/backup.js
 */
import { backupNow } from '../server/lib/backup.js'

const result = backupNow()
if (result.skipped) console.log(`  Already backed up today: ${result.path}`)
if (result.thinned) console.log(`  Thinned ${result.thinned} older copies.`)
