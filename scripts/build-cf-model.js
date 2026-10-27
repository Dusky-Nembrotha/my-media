/*
 * Build the collaborative-filtering model.
 *
 * The idea is the one you would use yourself: find the people who rated the
 * films you rated, the way you rated them, and see what else they thought was
 * good. Done properly that means item-to-item similarity — for each film in
 * your library, which other films are rated similarly by the same people.
 *
 * Similarity is cosine over mean-centred ratings ("adjusted cosine"), which
 * cancels out the fact that some people mark everything 4 and others spread
 * across the whole scale. Pairs with few raters in common are shrunk towards
 * zero, because two films sharing nine viewers is a coincidence, not a signal.
 *
 * Only similarities *from your own rated films* are computed — a few hundred
 * rows against the popular catalogue, rather than the whole 87,000 × 87,000
 * matrix, which is what makes this finish on a Raspberry Pi.
 *
 *   node scripts/build-cf-model.js
 *   node scripts/build-cf-model.js --min-ratings 300 --neighbours 80
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { all, DATA_DIR } from '../server/lib/db.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? Number(process.argv[i + 1]) : fallback
}

const MIN_ITEM_RATINGS = arg('--min-ratings', 400)   // how well known a film must be to be a candidate
const NEIGHBOURS = arg('--neighbours', 80)           // how many to keep per film of yours
const CO_SHRINK = arg('--co-shrink', 25)             // pairs with few shared raters are discounted
const MIN_CO = arg('--min-co', 8)                    // below this, ignore the pair entirely

const dir = join(DATA_DIR, 'movielens')
const ratingsPath = join(dir, 'ratings.csv')
const linksPath = join(dir, 'links.csv')

for (const p of [ratingsPath, linksPath]) {
  if (!existsSync(p)) {
    console.error(`\n  ${p} is missing. Run: node scripts/fetch-movielens.js\n`)
    process.exit(1)
  }
}

const since = Date.now()
const mark = (msg) => console.log(`  [${String(Math.round((Date.now() - since) / 1000)).padStart(3)}s] ${msg}`)

console.log(`\n  Building from ${(statSync(ratingsPath).size / 1048576).toFixed(0)} MB of ratings\n`)

/* ---------------------------------------------------------------- the files */

/** Stream a CSV, handing each line to `onLine` as a raw string. */
function readLines(path, onLine) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path, { highWaterMark: 1 << 20 })
    let tail = ''
    stream.on('data', (chunk) => {
      const text = tail + chunk.toString('latin1')
      let start = 0
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) !== 10) continue
        onLine(text.slice(start, i))
        start = i + 1
      }
      tail = text.slice(start)
    })
    stream.on('end', () => { if (tail) onLine(tail); resolve() })
    stream.on('error', reject)
  })
}

// movieId -> tmdbId, and back again.
const movieToTmdb = new Map()
const tmdbToMovie = new Map()
let firstLink = true
await readLines(linksPath, (line) => {
  if (firstLink) { firstLink = false; return }
  const a = line.indexOf(',')
  const b = line.indexOf(',', a + 1)
  if (a < 0 || b < 0) return
  const movieId = Number(line.slice(0, a))
  const tmdbId = Number(line.slice(b + 1).trim())
  if (!movieId || !tmdbId) return
  movieToTmdb.set(movieId, tmdbId)
  tmdbToMovie.set(tmdbId, movieId)
})
mark(`links: ${movieToTmdb.size} films carry a TMDB id`)

/* -------------------------------------------------------- what you've rated */

const mineRows = all(`
  SELECT w.tmdb_id, max(e.rating) rating
    FROM works w JOIN entries e ON e.work_id = w.id
   WHERE w.type IN ('film', 'tv') AND w.tmdb_id IS NOT NULL AND e.rating IS NOT NULL
   GROUP BY w.tmdb_id`)

const mineMovieIds = []
const mineRating = new Map()
for (const r of mineRows) {
  const movieId = tmdbToMovie.get(Number(r.tmdb_id))
  if (!movieId) continue
  mineMovieIds.push(movieId)
  mineRating.set(movieId, r.rating)
}
if (!mineMovieIds.length) {
  console.error('\n  None of your rated films matched a MovieLens entry. Nothing to build.\n')
  process.exit(1)
}
const mineIndex = new Map(mineMovieIds.map((id, i) => [id, i]))
mark(`yours: ${mineRows.length} rated titles, ${mineMovieIds.length} of them in the dataset`)

/* ------------------------------------------------ pass one: who rated what */

const MAX_MOVIE_ID = 300000
const MAX_USER_ID = 400000
const itemCount = new Int32Array(MAX_MOVIE_ID)
const userSum = new Float64Array(MAX_USER_ID)
const userCount = new Int32Array(MAX_USER_ID)

let rows = 0
let firstRating = true
await readLines(ratingsPath, (line) => {
  if (firstRating) { firstRating = false; return }
  const a = line.indexOf(',')
  const b = line.indexOf(',', a + 1)
  const c = line.indexOf(',', b + 1)
  if (a < 0 || b < 0) return
  const userId = Number(line.slice(0, a))
  const movieId = Number(line.slice(a + 1, b))
  const rating = Number(c < 0 ? line.slice(b + 1) : line.slice(b + 1, c))
  if (!userId || !movieId || !Number.isFinite(rating)) return
  if (movieId < MAX_MOVIE_ID) itemCount[movieId]++
  if (userId < MAX_USER_ID) { userSum[userId] += rating; userCount[userId]++ }
  rows++
  if (rows % 8_000_000 === 0) mark(`  …${(rows / 1e6).toFixed(0)}M ratings read`)
})
mark(`pass 1 done: ${(rows / 1e6).toFixed(1)}M ratings`)

// The candidate catalogue: films known well enough for a similarity to mean
// something, that we can also map back to TMDB.
const popular = []
for (let id = 1; id < MAX_MOVIE_ID; id++) {
  if (itemCount[id] >= MIN_ITEM_RATINGS && movieToTmdb.has(id)) popular.push(id)
}
const popIndex = new Map(popular.map((id, i) => [id, i]))
const M = mineMovieIds.length
const P = popular.length
mark(`catalogue: ${P} films with ${MIN_ITEM_RATINGS}+ ratings`)
mark(`matrix: ${M} × ${P} = ${((M * P) / 1e6).toFixed(1)}M cells (${((M * P * 8) / 1048576).toFixed(0)} MB)`)

/* ------------------------------------- pass two: co-rating dot products */

const dot = new Float32Array(M * P)
const co = new Int32Array(M * P)
const normMine = new Float64Array(M)
const normPop = new Float64Array(P)

let currentUser = -1
let blockMine = []     // [mineIdx, centred]
let blockPop = []      // [popIdx, centred]

function flush() {
  if (!blockMine.length || !blockPop.length) return
  for (let i = 0; i < blockMine.length; i += 2) {
    const m = blockMine[i]
    const cm = blockMine[i + 1]
    const base = m * P
    for (let j = 0; j < blockPop.length; j += 2) {
      const idx = base + blockPop[j]
      dot[idx] += cm * blockPop[j + 1]
      co[idx]++
    }
  }
}

rows = 0
firstRating = true
await readLines(ratingsPath, (line) => {
  if (firstRating) { firstRating = false; return }
  const a = line.indexOf(',')
  const b = line.indexOf(',', a + 1)
  const c = line.indexOf(',', b + 1)
  if (a < 0 || b < 0) return
  const userId = Number(line.slice(0, a))
  const movieId = Number(line.slice(a + 1, b))
  const rating = Number(c < 0 ? line.slice(b + 1) : line.slice(b + 1, c))
  if (!userId || !movieId || !Number.isFinite(rating)) return

  if (userId !== currentUser) {
    flush()
    currentUser = userId
    blockMine = []
    blockPop = []
  }

  const n = userId < MAX_USER_ID ? userCount[userId] : 0
  if (!n) return
  const centred = rating - userSum[userId] / n

  const mi = mineIndex.get(movieId)
  if (mi !== undefined) { blockMine.push(mi, centred); normMine[mi] += centred * centred }
  const pi = popIndex.get(movieId)
  if (pi !== undefined) { blockPop.push(pi, centred); normPop[pi] += centred * centred }

  rows++
  if (rows % 8_000_000 === 0) mark(`  …${(rows / 1e6).toFixed(0)}M ratings paired`)
})
flush()
mark('pass 2 done')

/* -------------------------------------------------------------- the model */

const out = new DatabaseSync(join(DATA_DIR, 'cf.db'))
out.exec(`
  DROP TABLE IF EXISTS cf_neighbour;
  CREATE TABLE cf_neighbour (
    tmdb_id    INTEGER NOT NULL,
    other_tmdb INTEGER NOT NULL,
    sim        REAL    NOT NULL,
    co         INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cf_meta (key TEXT PRIMARY KEY, value TEXT);
`)

const insert = out.prepare('INSERT INTO cf_neighbour (tmdb_id, other_tmdb, sim, co) VALUES (?,?,?,?)')
out.exec('BEGIN')

let written = 0
for (let m = 0; m < M; m++) {
  const mineTmdb = movieToTmdb.get(mineMovieIds[m])
  if (!mineTmdb || normMine[m] <= 0) continue
  const base = m * P
  const rootMine = Math.sqrt(normMine[m])

  const found = []
  for (let p = 0; p < P; p++) {
    const shared = co[base + p]
    if (shared < MIN_CO) continue
    if (popular[p] === mineMovieIds[m]) continue
    const denom = rootMine * Math.sqrt(normPop[p])
    if (denom <= 0) continue
    // Shrink towards zero when few people rated both: a perfect correlation
    // across nine viewers is noise wearing a convincing number.
    const sim = (dot[base + p] / denom) * (shared / (shared + CO_SHRINK))
    if (sim <= 0.02) continue
    found.push([movieToTmdb.get(popular[p]), sim, shared])
  }

  found.sort((a, b) => b[1] - a[1])
  for (const [otherTmdb, sim, shared] of found.slice(0, NEIGHBOURS)) {
    if (!otherTmdb) continue
    insert.run(mineTmdb, otherTmdb, sim, shared)
    written++
  }
}

out.exec('COMMIT')
out.exec('CREATE INDEX cf_mine ON cf_neighbour(tmdb_id)')
out.exec('CREATE INDEX cf_other ON cf_neighbour(other_tmdb)')

const meta = out.prepare('INSERT INTO cf_meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
for (const [k, v] of [
  ['built_at', new Date().toISOString()],
  ['ratings', String(rows)],
  ['seed_films', String(M)],
  ['catalogue', String(P)],
  ['min_item_ratings', String(MIN_ITEM_RATINGS)],
  ['neighbours', String(NEIGHBOURS)],
]) meta.run(k, v)

out.close()
mark(`wrote ${written} neighbour rows to ${join(DATA_DIR, 'cf.db')}`)
console.log('\n  Done. Suggestions will use it on the next refresh.\n')
