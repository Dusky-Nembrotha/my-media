/*
 * IMDb's own ratings, as a local table.
 *
 * OMDb is the only free way to ask IMDb a question one title at a time, and
 * it allows a thousand questions a day — which a single chart can spend. IMDb
 * publishes the same numbers as a bulk download, refreshed every morning, and
 * licenses them for personal non-commercial use, which is what this is. One
 * download replaces every lookup, for ever, with no limit and no key.
 *
 * Two files: the ratings themselves (8MB, every rated title) and the titles
 * they belong to (219MB, every title including eleven million episodes). The
 * second is only needed to match by name when a TMDB id has not told us the
 * IMDb one, so episodes and the rest are thrown away as they stream past.
 *
 *   node scripts/fetch-imdb-ratings.js
 *
 * Lives in its own database: it is a published dataset, not your library, and
 * it has no business in your backups.
 */
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchBuffer } from '../server/lib/fetchv4.js'
import { normaliseTitle } from '../server/lib/util.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.SHELVED_DATA || join(root, 'data')
const workDir = join(dataDir, 'imdb')
const dbPath = join(dataDir, 'imdb.db')

/* The kinds of thing this app can hold. Episodes are the bulk of the file
   and are never what you are logging. */
const KEEP = new Set(['movie', 'tvMovie', 'tvSeries', 'tvMiniSeries', 'tvSpecial', 'video', 'videoGame'])

const FILES = {
  ratings: 'title.ratings.tsv.gz',
  basics: 'title.basics.tsv.gz',
}

mkdirSync(workDir, { recursive: true })

async function download(name) {
  const path = join(workDir, name)
  // A day old is current: IMDb rebuilds these overnight.
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < 20 * 60 * 60 * 1000) {
    console.log(`  ${name} — already have today's`)
    return path
  }
  process.stdout.write(`  ${name} — downloading… `)
  const res = await fetchBuffer(`https://datasets.imdbws.com/${name}`, { timeout: 300000 })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${name}`)
  writeFileSync(path, res.body)
  console.log(`${(res.body.length / 1048576).toFixed(1)} MB`)
  return path
}

/*
 * The file is gzip on disk — unless the transfer decoded it on the way in,
 * which depends on headers IMDb is free to change. The first two bytes say
 * which, so neither case needs guessing about.
 */
function lines(path) {
  const magic = Buffer.alloc(2)
  const fd = openSync(path, 'r')
  readSync(fd, magic, 0, 2, 0)
  closeSync(fd)
  const gzipped = magic[0] === 0x1f && magic[1] === 0x8b
  const stream = createReadStream(path)
  return createInterface({ input: gzipped ? stream.pipe(createGunzip()) : stream, crlfDelay: Infinity })
}

const ratingsPath = await download(FILES.ratings)
const basicsPath = await download(FILES.basics)

if (existsSync(dbPath)) {
  // Rebuilt wholesale rather than merged: it is a snapshot of someone else's
  // file, and half of yesterday's mixed into today's is nobody's data.
  const { unlinkSync } = await import('node:fs')
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix)
  }
}

const db = new DatabaseSync(dbPath)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE imdb (
    tconst TEXT PRIMARY KEY,
    rating REAL NOT NULL,
    votes  INTEGER NOT NULL,
    title  TEXT,
    norm   TEXT,
    year   INTEGER,
    type   TEXT
  );
`)

console.log('\n  Reading ratings…')
let n = 0
db.exec('BEGIN')
const insert = db.prepare('INSERT OR REPLACE INTO imdb (tconst, rating, votes) VALUES (?, ?, ?)')
for await (const line of lines(ratingsPath)) {
  const [tconst, rating, votes] = line.split('\t')
  if (!tconst || tconst === 'tconst') continue
  insert.run(tconst, Number(rating), Number(votes))
  if (++n % 250000 === 0) process.stdout.write(`\r    ${n.toLocaleString('en-GB')} rated titles`)
}
db.exec('COMMIT')
console.log(`\r    ${n.toLocaleString('en-GB')} rated titles`)

console.log('\n  Matching them to titles…')
let seen = 0, kept = 0
db.exec('BEGIN')
const name = db.prepare('UPDATE imdb SET title = ?, norm = ?, year = ?, type = ? WHERE tconst = ?')
for await (const line of lines(basicsPath)) {
  const [tconst, type, primary, , , startYear] = line.split('\t')
  if (!tconst || tconst === 'tconst') continue
  if (++seen % 1000000 === 0) process.stdout.write(`\r    read ${(seen / 1e6).toFixed(0)}M rows, kept ${kept.toLocaleString('en-GB')}`)
  if (!KEEP.has(type)) continue
  const changed = name.run(primary, normaliseTitle(primary), startYear === '\\N' ? null : Number(startYear), type, tconst)
  if (changed.changes) kept++
}
db.exec('COMMIT')
console.log(`\r    read ${(seen / 1e6).toFixed(1)}M rows, kept ${kept.toLocaleString('en-GB')}`)

console.log('\n  Tidying…')
db.exec("DELETE FROM imdb WHERE title IS NULL")
db.exec('CREATE INDEX imdb_norm_idx ON imdb(norm, year)')
db.exec('CREATE INDEX imdb_norm_only_idx ON imdb(norm)')
db.exec('VACUUM')

const total = db.prepare('SELECT count(*) c FROM imdb').get().c
db.close()

console.log(`\n  ${total.toLocaleString('en-GB')} titles with an IMDb score — ${(statSync(dbPath).size / 1048576).toFixed(0)} MB`)
console.log(`  Written to ${dbPath}\n`)
