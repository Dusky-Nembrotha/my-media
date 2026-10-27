/*
 * Does the crowd model actually know your taste? Check it against your own
 * ratings before trusting it with suggestions.
 *
 * Five-fold cross-validation over the films (or books) you have rated: each
 * fold hides a fifth of them, places you in the model from the rest, and
 * predicts the hidden ones. Reported:
 *
 *   RMSE   how far the predicted stars are from what you gave, against the
 *          baseline of guessing your own average every time
 *   AUC    how often something you rated 4+ outranks something you rated 3-
 *          (0.5 is a coin toss, 1.0 is perfect), for the full prediction and
 *          for the crowd score the engine actually ranks by
 *   fame   where the top fifty suggestions sit in the model's popularity
 *          order, next to where your own library sits — the measure of
 *          whether the list is a discovery or the usual canon
 *
 * Reads the live library read-only; writes nothing.
 *
 *   node scripts/eval-recommender.js            # films
 *   node scripts/eval-recommender.js --type book
 *   node scripts/eval-recommender.js --quality 0.5 --popularity 0.12
 */
import { all, json } from '../server/lib/db.js'
import * as cf from '../server/lib/cf.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : fallback
}
const type = arg('--type', 'film')
const mix = { quality: Number(arg('--quality', 0.5)), popularity: Number(arg('--popularity', 0.12)) }
const model = type === 'film' ? cf.film : cf.books

if (!model.available()) {
  console.error(`\n  No ${type} model built. Run: node scripts/build-cf-model.js${type === 'book' ? ' --source goodbooks' : ''}\n`)
  process.exit(1)
}

const rows = all(
  `SELECT w.title, w.creators, w.tmdb_id, max(e.rating) rating
     FROM works w JOIN entries e ON e.work_id = w.id
    WHERE w.type = ? AND e.rating IS NOT NULL
    GROUP BY w.id`,
  type,
)
const rated = rows.map((r) => ({
  title: r.title,
  rating: r.rating,
  id: type === 'film'
    ? Number(r.tmdb_id) || null
    : model.match(r.title, json(r.creators, []).find((c) => c.role === 'Author' || !c.role)?.name),
})).filter((r) => r.id && model.knows(r.id))

const info = model.info()
console.log(`\n  ${type}: ${rows.length} rated, ${rated.length} known to the model (${info.items} titles, built ${info.built_at.slice(0, 10)})\n`)
if (rated.length < 10) {
  console.log('  Too few to evaluate.\n')
  process.exit(0)
}

const FOLDS = 5
const pairs = []
let se = 0
let seBase = 0
for (let f = 0; f < FOLDS; f++) {
  const train = rated.filter((_, i) => i % FOLDS !== f)
  const test = rated.filter((_, i) => i % FOLDS === f)
  const user = model.foldIn(train)
  if (!user) continue
  for (const t of test) {
    const s = model.score(user, t.id, mix)
    if (!s) continue
    se += (s.predicted - t.rating) ** 2
    seBase += (user.mean - t.rating) ** 2
    pairs.push({ actual: t.rating, predicted: s.predicted, score: s.score })
  }
}

const auc = (key) => {
  const pos = pairs.filter((p) => p.actual >= 4)
  const neg = pairs.filter((p) => p.actual <= 3)
  if (!pos.length || !neg.length) return NaN
  let wins = 0
  for (const a of pos) for (const b of neg) wins += a[key] > b[key] ? 1 : a[key] === b[key] ? 0.5 : 0
  return wins / (pos.length * neg.length)
}

console.log(`  RMSE  ${Math.sqrt(se / pairs.length).toFixed(3)} stars (guessing your average: ${Math.sqrt(seBase / pairs.length).toFixed(3)})`)
console.log(`  AUC   ${auc('predicted').toFixed(3)} by predicted rating, ${auc('score').toFixed(3)} by the ranking score at quality=${mix.quality} popularity=${mix.popularity}`)

// Fame: popularity rank within the model, by how many people rated each title.
const user = model.foldIn(rated)
const top = model.rankAll(user, { ...mix, limit: 50 })
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
console.log(`  fame  top 50 suggestions were rated by a median ${median(top.map((t) => t.n)).toLocaleString('en-GB')} people; your library's titles by ${median(rated.map((r) => model.score(user, r.id)?.n ?? 0)).toLocaleString('en-GB')}`)
console.log(`  mean predicted rating of the top 50: ${(top.reduce((a, t) => a + t.predicted, 0) / top.length).toFixed(2)}\n`)
