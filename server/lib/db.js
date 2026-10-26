import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const dataDir = process.env.SHELVED_DATA || process.env.MYMEDIA_DATA || join(root, 'data')

mkdirSync(dataDir, { recursive: true })

export const DATA_DIR = dataDir
/*
 * New installs get shelved.db; an existing mymedia.db is used where it is,
 * so renaming the app never puts anyone's library at risk.
 */
const legacy = join(dataDir, 'mymedia.db')
const current = join(dataDir, 'shelved.db')
const dbPath = existsSync(current) || !existsSync(legacy) ? current : legacy

export const DB_PATH = dbPath
export const db = new DatabaseSync(dbPath)

db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))

/*
 * Migrations for databases created before a column existed. Each is written to
 * be safe to run repeatedly: we look before we leap, and never drop anything.
 */
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)
}

function addColumn(table, column, definition) {
  if (hasColumn(table, column)) return false
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  return true
}

const migrated = [
  // Ownership, so that supporting more than one person later is a filter
  // change rather than a data migration.
  ['entries', 'user_id'], ['recs', 'user_id'], ['lists', 'user_id'],
  ['import_runs', 'user_id'], ['rec_cache', 'user_id'], ['rec_blocks', 'user_id'],
  ['connections', 'user_id'],
].filter(([table, column]) => addColumn(table, column, 'INTEGER NOT NULL DEFAULT 1'))

if (migrated.length) {
  console.log(`  migrated: added ${migrated.map(([t]) => t).join(', ')}.user_id`)
}

// Indexes that depend on migrated columns, so they come after the ALTERs.
db.exec('CREATE INDEX IF NOT EXISTS entries_user_idx ON entries(user_id, consumed_on DESC)')

/** Rows as plain objects (node:sqlite returns null-prototype objects). */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params).map((r) => ({ ...r }))
}

export function get(sql, ...params) {
  const row = db.prepare(sql).get(...params)
  return row ? { ...row } : undefined
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params)
}

export function tx(fn) {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    try { db.exec('ROLLBACK') } catch {}
    throw err
  }
}

export function json(value, fallback) {
  if (value == null) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}
