import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const dataDir = process.env.MYMEDIA_DATA || join(root, 'data')

mkdirSync(dataDir, { recursive: true })

export const DATA_DIR = dataDir
export const db = new DatabaseSync(join(dataDir, 'mymedia.db'))

db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))

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
