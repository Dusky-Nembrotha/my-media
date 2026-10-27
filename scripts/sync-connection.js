/*
 * Run a live connection's sync from the command line.
 *
 * The same thing the Sync button does — fetch from the service, apply the
 * records, record an import run so it can be undone from the history page.
 *
 *   node scripts/sync-connection.js plex
 *   node scripts/sync-connection.js plex --dry
 */
import { run, get } from '../server/lib/db.js'
import { getConnector } from '../server/connections/index.js'
import { loadConnection, saveConnection } from '../server/connections/store.js'
import { applyRecords } from '../server/importers/apply.js'

const id = process.argv[2]
const dry = process.argv.includes('--dry')
const connector = getConnector(id)
if (!connector) {
  console.error(`\n  Unknown service: ${id}\n`)
  process.exit(1)
}

const conn = loadConnection(id)
if (conn.status !== 'connected') {
  console.error(`\n  ${connector.label} is not connected.\n`)
  process.exit(1)
}

console.log(`\n  Syncing ${connector.label}…`)
const records = await connector.sync({ config: conn.config, tokens: conn.tokens, options: {} })
console.log(`  ${records.length} records fetched`)

if (dry) {
  for (const r of records.slice(0, 10)) {
    console.log(`   ${r.type}  ${r.title}  ${r.consumed_on || 'no date'}${r.rating ? `  ★${r.rating}` : ''}`)
  }
  console.log('\n  Dry run; nothing written.\n')
  process.exit(0)
}

const started = run(
  "INSERT INTO import_runs (user_id, source, filename, status) VALUES (1, ?, 'live sync', 'running')",
  id,
)
const runId = Number(started.lastInsertRowid)

const summary = applyRecords(records, { source: id, filename: 'live sync', enrich: true })

run(
  `UPDATE import_runs SET status = 'done', works_added = ?, entries_added = ?, entries_skipped = ?,
        finished_at = datetime('now') WHERE id = ?`,
  summary.worksAdded, summary.entriesAdded, summary.entriesSkipped, runId,
)
saveConnection(id, { last_sync_at: new Date().toISOString(), last_result: { entries: summary.entriesAdded } })

console.log(`  added ${summary.entriesAdded} entries and ${summary.worksAdded} titles`
  + `${summary.entriesSkipped ? `, skipped ${summary.entriesSkipped} already there` : ''}`)
console.log('  Import → history → Undo takes it back.\n')
