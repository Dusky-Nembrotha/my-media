import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, DB_PATH } from './db.js'

/*
 * The library backs itself up.
 *
 * Years of ratings and hand-picked covers sitting in a single file on a single
 * SD card is one bad moment away from gone, and a backup that depends on
 * remembering to run it is not a backup.
 *
 * VACUUM INTO is used rather than a file copy: it is consistent even while the
 * app is writing, and it compacts as it goes, so a 45 MB working database
 * produces a 4 MB snapshot.
 */
const KEEP_DAILY = 14
const DAY_MS = 24 * 60 * 60 * 1000

export function backupNow({ quiet = false } = {}) {
  const dir = join(DATA_DIR, 'backups')
  mkdirSync(dir, { recursive: true })

  const target = join(dir, `shelved-${new Date().toISOString().slice(0, 10)}.db`)
  if (existsSync(target)) return { skipped: true, path: target }

  let db
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  } catch (err) {
    if (!quiet) console.warn(`[shelved] backup failed: ${err.message}`)
    return { error: err.message }
  } finally {
    try { db?.close() } catch { /* already closed */ }
  }

  // Keep a fortnight of daily copies, then one per month.
  const files = readdirSync(dir)
    .filter((f) => /^shelved-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
  const months = new Set()
  let thinned = 0
  files.forEach((file, i) => {
    if (i < KEEP_DAILY) return
    const month = file.slice(8, 15)
    if (!months.has(month)) { months.add(month); return }
    try { unlinkSync(join(dir, file)) ; thinned++ } catch { /* already gone */ }
  })

  const size = existsSync(target) ? statSync(target).size : 0
  if (!quiet) {
    console.log(`  Backed up to ${target} (${(size / 1048576).toFixed(1)} MB)`)
  }
  return { path: target, size, thinned }
}

/** Once at startup, then daily for as long as the app is up. */
export function scheduleBackups() {
  backupNow({ quiet: true })
  const timer = setInterval(() => backupNow({ quiet: true }), DAY_MS)
  // Never hold the process open for the sake of a backup timer.
  timer.unref?.()
  return timer
}
