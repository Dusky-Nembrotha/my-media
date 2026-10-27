/*
 * Build a collaborative-filtering model.
 *
 * This learns a matrix factorisation of a public ratings dataset: every title
 * gets a short vector of numbers describing *what kind of people like it*,
 * and the model's prediction for any person is their own vector dotted with
 * the title's. The person's vector is worked out at request time from
 * whatever they have rated (see server/lib/cf.js), so the model is built once
 * from the public data and never needs rebuilding because your library
 * changed.
 *
 * It replaces an item-to-item "films rated like yours" table, which had a
 * flaw that no amount of tuning fixed: the films that sit next to *everything*
 * are the famous ones, so the suggestions were the IMDb Top 250 minus what you
 * had already seen. A factor model separates "widely thought good" (the film's
 * bias term) from "people with your particular taste like it more than most"
 * (the dot product), and the engine can weigh those two things deliberately.
 *
 * Training is plain stochastic gradient descent on the biased model
 *     r ≈ μ + b_user + b_item + p_user · q_item
 * (Koren, Bell & Volinsky 2009). Thirty-two million ratings fit in memory as
 * typed arrays; each epoch is one shuffled pass over them.
 *
 * Two sources are understood:
 *   movielens  — films, keyed on TMDB ids, written to data/cf.db (~10 minutes)
 *   goodbooks  — books, keyed on goodbooks ids, written to data/cf-books.db
 *                (~2 minutes); titles and authors are kept so the engine can
 *                join them onto your library
 *
 *   node scripts/build-cf-model.js
 *   node scripts/build-cf-model.js --source goodbooks
 *   node scripts/build-cf-model.js --factors 48 --epochs 20 --min-ratings 20
 */
import { createReadStream, existsSync, statSync, renameSync, rmSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DATA_DIR } from '../server/lib/db.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : fallback
}
const num = (name, fallback) => Number(arg(name, fallback))

const SOURCE = arg('--source', 'movielens')
const FACTORS = num('--factors', 48)
const EPOCHS = num('--epochs', 20)
const LEARNING_RATE = num('--lr', 0.007)
const REG = num('--reg', 0.04)              // on the factor vectors
const REG_BIAS = num('--reg-bias', 0.01)    // on the bias terms
const DECAY = num('--decay', 0.92)          // learning rate, per epoch
// A title has to be rated this often before its vector is trustworthy enough
// to be worth storing (and so, suggesting).
const MIN_ITEM_RATINGS = num('--min-ratings', 20)
// One rating in this many is held back to report an honest error figure.
const HOLDOUT_EVERY = 50

const SOURCES = {
  movielens: {
    dir: 'movielens',
    ratings: 'ratings.csv',   // userId,movieId,rating,timestamp
    catalogue: 'links.csv',   // movieId,imdbId,tmdbId
    output: 'cf.db',
    key: 'tmdb',
    fetch: 'node scripts/fetch-movielens.js',
  },
  goodbooks: {
    dir: 'goodbooks',
    ratings: 'ratings.csv',   // user_id,book_id,rating
    catalogue: 'books.csv',   // book_id,…,isbn,…,authors,original_publication_year,original_title,title,…
    output: 'cf-books.db',
    key: 'goodbooks',
    fetch: 'node scripts/fetch-goodbooks.js',
  },
}
const source = SOURCES[SOURCE]
if (!source) {
  console.error(`\n  Unknown source "${SOURCE}". One of: ${Object.keys(SOURCES).join(', ')}\n`)
  process.exit(1)
}

const dir = join(DATA_DIR, source.dir)
const ratingsPath = join(dir, source.ratings)
const cataloguePath = join(dir, source.catalogue)

for (const p of [ratingsPath, cataloguePath]) {
  if (!existsSync(p)) {
    console.error(`\n  ${p} is missing. Run: ${source.fetch}\n`)
    process.exit(1)
  }
}

const since = Date.now()
const mark = (msg) => console.log(`  [${String(Math.round((Date.now() - since) / 1000)).padStart(4)}s] ${msg}`)

console.log(`\n  Building a ${FACTORS}-factor ${SOURCE} model from ${(statSync(ratingsPath).size / 1048576).toFixed(0)} MB of ratings\n`)

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

/** Count newlines without building strings: how big the arrays must be. */
function countLines(path) {
  const fd = openSync(path, 'r')
  const buf = Buffer.alloc(1 << 20)
  let lines = 0
  let read
  while ((read = readSync(fd, buf, 0, buf.length, null)) > 0) {
    for (let i = 0; i < read; i++) if (buf[i] === 10) lines++
  }
  closeSync(fd)
  return lines + 1
}

/** A small CSV parser for the catalogue files, which carry quoted titles. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

/*
 * The catalogue: source item id -> the id the library can join on, and for
 * books the title and author too, because that is the only join there is.
 */
const externalId = new Map()
const titles = new Map()

if (SOURCE === 'movielens') {
  let first = true
  await readLines(cataloguePath, (line) => {
    if (first) { first = false; return }
    const a = line.indexOf(',')
    const b = line.indexOf(',', a + 1)
    if (a < 0 || b < 0) return
    const movieId = Number(line.slice(0, a))
    const tmdbId = Number(line.slice(b + 1).trim())
    if (movieId && tmdbId) externalId.set(movieId, tmdbId)
  })
  mark(`links: ${externalId.size} films carry a TMDB id`)
} else {
  const rows = parseCsv(readFileSync(cataloguePath, 'utf8'))
  const head = rows[0]
  const col = (name) => head.indexOf(name)

  /*
   * Readers' shelf names, as the nearest thing to genres the data has.
   * Most shelves are bookkeeping ("to-read", "owned", "kindle"); those go,
   * and the six most-used of what is left are kept per book.
   */
  const BOOKKEEPING = /^(to-read|currently-reading|owned|own|books-i-own|favou?rites?|favorite|kindle|ebook|e-book|audiobook|audio|audible|library|default|re-read|reread|my-books|wish-?list|borrowed|read-in-\d+|\d{4}|all-time-favou?rites?|to-buy|have|home|unread|dnf|abandoned|read|tbr|maybe|paperback|hardcover|owned-books|my-library|english|series|book-club|ya|adult|novels?|fiction|books|general|-|--1-)$/
  const tagsPath = join(dir, 'tags.csv')
  const bookTagsPath = join(dir, 'book_tags.csv')
  const tagsByGoodreads = new Map()
  if (existsSync(tagsPath) && existsSync(bookTagsPath)) {
    const tagName = new Map()
    for (const r of parseCsv(readFileSync(tagsPath, 'utf8')).slice(1)) if (r[0]) tagName.set(Number(r[0]), r[1])
    for (const r of parseCsv(readFileSync(bookTagsPath, 'utf8')).slice(1)) {
      const goodreadsId = Number(r[0])
      const name = tagName.get(Number(r[1]))
      if (!goodreadsId || !name || BOOKKEEPING.test(name)) continue
      const list = tagsByGoodreads.get(goodreadsId) || []
      if (list.length < 6) { list.push(name); tagsByGoodreads.set(goodreadsId, list) }
    }
    mark(`tags: ${tagsByGoodreads.size} books carry reader shelves`)
  }

  for (const r of rows.slice(1)) {
    const id = Number(r[col('book_id')])
    if (!id) continue
    externalId.set(id, id)
    const isbn13 = r[col('isbn13')]
    titles.set(id, {
      tags: (tagsByGoodreads.get(Number(r[col('goodreads_book_id')])) || []).join(','),
      title: r[col('title')],
      original_title: r[col('original_title')] || null,
      authors: r[col('authors')],
      year: Number(r[col('original_publication_year')]) || null,
      isbn: r[col('isbn')] || null,
      // Stored as a float in the file ("9.78043902348e+12").
      isbn13: isbn13 && /e\+/.test(isbn13) ? String(Math.round(Number(isbn13))) : (isbn13 || null),
      cover_url: r[col('image_url')] || null,
      ratings_count: Number(r[col('ratings_count')]) || 0,
      average: Number(r[col('average_rating')]) || null,
    })
  }
  mark(`books: ${titles.size} titles`)
}

/* ------------------------------------------------------- load the ratings */

/*
 * Everything in memory as flat typed arrays: 32M ratings is about 400 MB this
 * way, which the Pi has, and it is the only layout that makes twenty passes
 * over the data finish in minutes rather than hours.
 */
const CAPACITY = countLines(ratingsPath)
const userOf = new Int32Array(CAPACITY)
const itemOf = new Int32Array(CAPACITY)
const ratingOf = new Float32Array(CAPACITY)
const itemIndex = new Map()      // source item id -> dense index
const itemIds = []               // dense index -> source item id
let n = 0
let maxUser = 0
let firstRating = true

await readLines(ratingsPath, (line) => {
  if (firstRating) { firstRating = false; return }
  const a = line.indexOf(',')
  const b = line.indexOf(',', a + 1)
  const c = line.indexOf(',', b + 1)
  if (a < 0 || b < 0) return
  const userId = Number(line.slice(0, a))
  const itemId = Number(line.slice(a + 1, b))
  const rating = Number(c < 0 ? line.slice(b + 1) : line.slice(b + 1, c))
  if (!userId || !itemId || !Number.isFinite(rating) || n >= CAPACITY) return
  let item = itemIndex.get(itemId)
  if (item === undefined) {
    item = itemIds.length
    itemIndex.set(itemId, item)
    itemIds.push(itemId)
  }
  userOf[n] = userId
  itemOf[n] = item
  ratingOf[n] = rating
  if (userId > maxUser) maxUser = userId
  n++
  if (n % 8_000_000 === 0) mark(`  …${(n / 1e6).toFixed(0)}M ratings read`)
})

const ITEMS = itemIds.length
const USERS = maxUser + 1
mark(`loaded ${(n / 1e6).toFixed(1)}M ratings, ${ITEMS} titles, ${(USERS - 1)} people`)

const itemCount = new Int32Array(ITEMS)
const itemSum = new Float64Array(ITEMS)
let total = 0
for (let i = 0; i < n; i++) {
  itemCount[itemOf[i]]++
  itemSum[itemOf[i]] += ratingOf[i]
  total += ratingOf[i]
}
const MU = total / n

/* ------------------------------------------------------------- training */

const K = FACTORS
const P = new Float32Array(USERS * K)
const Q = new Float32Array(ITEMS * K)
const bu = new Float32Array(USERS)
const bi = new Float32Array(ITEMS)

// Small random start; zeros would leave every factor identical for ever.
let seed = 12345
const rand = () => {
  // xorshift: deterministic, so two builds from the same data agree.
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
  return ((seed >>> 0) / 4294967296)
}
for (let i = 0; i < P.length; i++) P[i] = (rand() - 0.5) * 0.1
for (let i = 0; i < Q.length; i++) Q[i] = (rand() - 0.5) * 0.1

// The visiting order. Ratings arrive grouped by person, and SGD on grouped
// data drifts; a shuffle each epoch is cheap next to the epoch itself.
const order = new Int32Array(n)
for (let i = 0; i < n; i++) order[i] = i
function shuffle() {
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = order[i]; order[i] = order[j]; order[j] = t
  }
}

const isHoldout = (idx) => idx % HOLDOUT_EVERY === 0

function rmse(onHoldout) {
  let sum = 0
  let count = 0
  for (let idx = 0; idx < n; idx += onHoldout ? HOLDOUT_EVERY : 7) {
    if (isHoldout(idx) !== onHoldout) continue
    const u = userOf[idx]
    const it = itemOf[idx]
    let dot = 0
    const pu = u * K
    const qi = it * K
    for (let f = 0; f < K; f++) dot += P[pu + f] * Q[qi + f]
    const err = ratingOf[idx] - (MU + bu[u] + bi[it] + dot)
    sum += err * err
    count++
  }
  return Math.sqrt(sum / Math.max(1, count))
}

let lr = LEARNING_RATE
for (let epoch = 1; epoch <= EPOCHS; epoch++) {
  shuffle()
  for (let o = 0; o < n; o++) {
    const idx = order[o]
    if (isHoldout(idx)) continue
    const u = userOf[idx]
    const it = itemOf[idx]
    const pu = u * K
    const qi = it * K

    let dot = 0
    for (let f = 0; f < K; f++) dot += P[pu + f] * Q[qi + f]
    const err = ratingOf[idx] - (MU + bu[u] + bi[it] + dot)

    bu[u] += lr * (err - REG_BIAS * bu[u])
    bi[it] += lr * (err - REG_BIAS * bi[it])
    for (let f = 0; f < K; f++) {
      const pf = P[pu + f]
      const qf = Q[qi + f]
      P[pu + f] = pf + lr * (err * qf - REG * pf)
      Q[qi + f] = qf + lr * (err * pf - REG * qf)
    }
  }
  lr *= DECAY
  mark(`epoch ${String(epoch).padStart(2)}/${EPOCHS}: held-out RMSE ${rmse(true).toFixed(4)}`)
}

const trainRmse = rmse(false)
const validRmse = rmse(true)
mark(`trained: RMSE ${trainRmse.toFixed(4)} on seen ratings, ${validRmse.toFixed(4)} on held-out ones`)

/* -------------------------------------------------------------- the model */

/*
 * Written to a sibling file and renamed into place, so a build that dies
 * half-way leaves the previous model untouched and the app still working.
 */
const finalPath = join(DATA_DIR, source.output)
const tmpPath = `${finalPath}.building`
rmSync(tmpPath, { force: true })
const out = new DatabaseSync(tmpPath)
out.exec(`
  CREATE TABLE cf_item (
    item_id  INTEGER PRIMARY KEY,  -- TMDB id for films, goodbooks id for books
    n        INTEGER NOT NULL,     -- how many people rated it
    mean     REAL    NOT NULL,     -- their average
    bias     REAL    NOT NULL,     -- the title's learnt offset from the global mean
    factors  BLOB    NOT NULL      -- float32[K]
  );
  CREATE TABLE cf_title (
    item_id        INTEGER PRIMARY KEY,
    title          TEXT NOT NULL,
    original_title TEXT,
    authors        TEXT,
    year           INTEGER,
    isbn           TEXT,
    isbn13         TEXT,
    cover_url      TEXT,
    tags           TEXT              -- readers' shelves, comma-separated (books)
  );
  CREATE TABLE cf_meta (key TEXT PRIMARY KEY, value TEXT);
`)

const insert = out.prepare('INSERT OR REPLACE INTO cf_item (item_id, n, mean, bias, factors) VALUES (?,?,?,?,?)')
const insertTitle = out.prepare('INSERT OR REPLACE INTO cf_title (item_id, title, original_title, authors, year, isbn, isbn13, cover_url, tags) VALUES (?,?,?,?,?,?,?,?,?)')
out.exec('BEGIN')
let written = 0
for (let it = 0; it < ITEMS; it++) {
  if (itemCount[it] < MIN_ITEM_RATINGS) continue
  const id = externalId.get(itemIds[it])
  if (!id) continue
  const vec = Q.slice(it * K, it * K + K)
  insert.run(id, itemCount[it], itemSum[it] / itemCount[it], bi[it], new Uint8Array(vec.buffer))
  const t = titles.get(itemIds[it])
  if (t) insertTitle.run(id, t.title, t.original_title, t.authors, t.year, t.isbn, t.isbn13, t.cover_url, t.tags || null)
  written++
}
out.exec('COMMIT')

const meta = out.prepare('INSERT INTO cf_meta (key, value) VALUES (?,?)')
for (const [k, v] of [
  ['model', 'mf'],
  ['source', SOURCE],
  ['key', source.key],
  ['built_at', new Date().toISOString()],
  ['factors', String(K)],
  ['mu', String(MU)],
  ['reg', String(REG)],
  ['reg_bias', String(REG_BIAS)],
  ['epochs', String(EPOCHS)],
  ['ratings', String(n)],
  ['users', String(USERS - 1)],
  ['items', String(written)],
  ['min_item_ratings', String(MIN_ITEM_RATINGS)],
  ['rmse_train', trainRmse.toFixed(4)],
  ['rmse_holdout', validRmse.toFixed(4)],
]) meta.run(k, v)
out.close()
renameSync(tmpPath, finalPath)

mark(`wrote ${written} titles to ${finalPath}`)
console.log('\n  Done. Suggestions will use it on the next refresh.\n')
