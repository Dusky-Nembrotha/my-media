import { DatabaseSync } from 'node:sqlite'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './db.js'

/*
 * The collaborative-filtering models: a factor vector for every film that the
 * 200,000 people in the MovieLens data rated often enough, and one for every
 * book in goodbooks-10k, learnt by scripts/build-cf-model.js.
 *
 * Nothing about you is in those files. Your side of the model — your own
 * vector and your own bias — is solved here from your ratings each time,
 * which takes a few milliseconds, so rating one more film changes the
 * suggestions straight away and the model itself never needs rebuilding.
 *
 * Each model lives in its own file so a rebuild never touches your library,
 * and so the app works perfectly well without them — everything here
 * degrades to "no opinion" when a model has not been built.
 */

/** Invert a k×k matrix (Gauss–Jordan with partial pivoting); A is destroyed. */
function invert(A, k) {
  const inv = new Float64Array(k * k)
  for (let i = 0; i < k; i++) inv[i * k + i] = 1
  for (let col = 0; col < k; col++) {
    let pivot = col
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r * k + col]) > Math.abs(A[pivot * k + col])) pivot = r
    if (pivot !== col) {
      for (let c = 0; c < k; c++) {
        let t = A[col * k + c]; A[col * k + c] = A[pivot * k + c]; A[pivot * k + c] = t
        t = inv[col * k + c]; inv[col * k + c] = inv[pivot * k + c]; inv[pivot * k + c] = t
      }
    }
    const d = A[col * k + col] || 1e-9
    for (let c = 0; c < k; c++) { A[col * k + c] /= d; inv[col * k + c] /= d }
    for (let r = 0; r < k; r++) {
      if (r === col) continue
      const f = A[r * k + col]
      if (!f) continue
      for (let c = 0; c < k; c++) { A[r * k + c] -= f * A[col * k + c]; inv[r * k + c] -= f * inv[col * k + c] }
    }
  }
  return inv
}

/*
 * Titles as a join key. Goodreads files "Sabriel (Abhorsen, #1)" and Open
 * Library "Sabriel"; this reduces both to "sabriel". Series names in
 * brackets, subtitles after a colon, leading articles and punctuation all go.
 */
export function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s*[:;].*$/, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const surname = (name) => String(name || '').toLowerCase().trim().split(/\s+/).pop()

const DEFAULT_MIX = { quality: 0.5, popularity: 0.12, familiar: 4000 }

function createModel(file) {
  const PATH = join(DATA_DIR, file)
  let model = null
  let loadedFrom = -1

  function load() {
    if (!existsSync(PATH)) { model = null; return null }
    // A rebuild renames a new file into place; pick it up without a restart.
    const stamp = statSync(PATH).mtimeMs
    if (model && stamp === loadedFrom) return model
    loadedFrom = stamp
    model = null
    try {
      const db = new DatabaseSync(PATH, { readOnly: true })
      try {
        const meta = {}
        for (const row of db.prepare('SELECT key, value FROM cf_meta').all()) meta[row.key] = row.value
        // An older item-to-item file has no factors to read.
        if (meta.model !== 'mf') return null
        const k = Number(meta.factors)
        const rows = db.prepare('SELECT item_id, n, mean, bias, factors FROM cf_item ORDER BY item_id').all()
        const count = rows.length
        const ids = new Int32Array(count)
        const n = new Int32Array(count)
        const mean = new Float32Array(count)
        const bias = new Float32Array(count)
        const Q = new Float32Array(count * k)
        const index = new Map()
        rows.forEach((row, i) => {
          ids[i] = row.item_id
          n[i] = row.n
          mean[i] = row.mean
          bias[i] = row.bias
          Q.set(new Float32Array(row.factors.buffer, row.factors.byteOffset, k), i * k)
          index.set(row.item_id, i)
        })

        // Books carry their titles, because a title is the only join there is.
        const titles = new Map()
        const byTitle = new Map()
        for (const t of db.prepare('SELECT * FROM cf_title').all()) {
          titles.set(t.item_id, t)
          for (const key of new Set([titleKey(t.title), titleKey(t.original_title)])) {
            if (!key) continue
            if (!byTitle.has(key)) byTitle.set(key, [])
            byTitle.get(key).push(t)
          }
        }

        model = {
          k, mu: Number(meta.mu), reg: Number(meta.reg) || 0.04, regBias: Number(meta.reg_bias) || 0.01,
          meta, count, ids, n, mean, bias, Q, index, titles, byTitle,
        }
      } finally {
        db.close()
      }
    } catch {
      model = null
    }
    return model
  }

  /** The crowd's score for one row; see rankAll for what goes into it. */
  function scoreRow(m, user, row, { quality, popularity, familiar }) {
    const { k, mu, Q } = m
    const n = m.n[row]
    let dot = 0
    const base = row * k
    for (let f = 0; f < k; f++) dot += user.p[f] * Q[base + f]
    /*
     * A title a few hundred people rated is a guess twice over: its vector is
     * noisy, and its bias is flattered — the only people who rate a stand-up
     * special are its fans. Shrinking both terms together is what keeps the
     * list from filling with obscurities that score 4.4 among the converted.
     */
    const confidence = n / (n + 600)
    const fame = Math.max(0, Math.log10(n) - Math.log10(familiar))
    return {
      item_id: m.ids[row],
      score: confidence * (dot + quality * m.bias[row]) - popularity * fame,
      // How many of your ratings went into the vector behind this number.
      basis: user.n ?? 0,
      lift: dot,
      bias: m.bias[row],
      predicted: mu + user.bias + m.bias[row] + dot,
      n,
    }
  }

  return {
    available: () => Boolean(load()),
    info: () => load()?.meta || null,

    /** Does the model know this title at all? */
    knows: (id) => Boolean(load()?.index.has(Number(id))),

    /** What the model stored about a title (books only: title, authors, ISBN). */
    describe: (id) => load()?.titles.get(Number(id)) || null,

    /**
     * Find a book by title and author. Editions differ, ISBNs differ, series
     * suffixes differ; a title key plus the author's surname is what survives.
     */
    match(title, author) {
      const m = load()
      if (!m) return null
      const hits = m.byTitle.get(titleKey(title)) || []
      if (!hits.length) return null
      const want = surname(author)
      const hit = want
        ? hits.find((t) => String(t.authors || '').toLowerCase().includes(want))
        : null
      return hit ? hit.item_id : null
    },

    /**
     * Work out where you sit in the model from what you have rated.
     *
     * This is the same least-squares problem the training solved for everyone
     * else, with the title vectors held fixed: find the vector and bias that
     * best explain your ratings, regularised exactly as training was so that
     * the answer lives in the same space. Your bias and your vector depend on
     * each other, so the two are refined alternately; three rounds is plenty.
     *
     * `rated` is [{ id, rating, weight? }]. A weight below one is for things
     * you logged but never rated: choosing to read something is evidence, but
     * not a four-star rating's worth. Returns null when too few of them are in
     * the model to say anything.
     */
    foldIn(rated, { minMatched = 5 } = {}) {
      const m = load()
      if (!m || !rated?.length) return null
      const { k, mu, Q } = m

      const rows = []
      const ratings = []
      const weights = []
      const byId = new Map()
      for (const r of rated) {
        const id = Number(r.id)
        const row = m.index.get(id)
        if (row == null || r.rating == null || byId.has(id)) continue
        byId.set(id, Number(r.rating))
        rows.push(row)
        ratings.push(Number(r.rating))
        weights.push(r.weight ?? 1)
      }
      const n = rows.length
      const evidence = weights.reduce((a, b) => a + b, 0)
      if (n < minMatched || evidence < minMatched) return null

      // Regularisation scales with how much you have rated, as it did in
      // training (where every rating added its own penalty on the vector).
      const lambda = m.reg * evidence
      const lambdaBias = m.regBias * evidence

      // The normal matrix depends only on *which* titles you rated, so it is
      // built once; the right-hand side changes as the bias settles.
      const A = new Float64Array(k * k)
      for (let i = 0; i < n; i++) {
        const base = rows[i] * k
        const w = weights[i]
        for (let f = 0; f < k; f++) {
          const qf = w * Q[base + f]
          const rowOff = f * k
          for (let g = f; g < k; g++) A[rowOff + g] += qf * Q[base + g]
        }
      }
      for (let f = 0; f < k; f++) {
        A[f * k + f] += lambda
        for (let g = f + 1; g < k; g++) A[g * k + f] = A[f * k + g]
      }
      const inverse = invert(A, k)

      let bias = 0
      let p = new Float64Array(k)
      const targets = new Float64Array(n)
      for (let round = 0; round < 3; round++) {
        const b = new Float64Array(k)
        for (let i = 0; i < n; i++) {
          const base = rows[i] * k
          targets[i] = ratings[i] - mu - bias - m.bias[rows[i]]
          for (let f = 0; f < k; f++) b[f] += weights[i] * Q[base + f] * targets[i]
        }
        p = new Float64Array(k)
        for (let f = 0; f < k; f++) for (let g = 0; g < k; g++) p[f] += inverse[f * k + g] * b[g]

        let sum = 0
        for (let i = 0; i < n; i++) {
          const base = rows[i] * k
          let dot = 0
          for (let f = 0; f < k; f++) dot += p[f] * Q[base + f]
          sum += weights[i] * (ratings[i] - mu - m.bias[rows[i]] - dot)
        }
        bias = sum / (evidence + lambdaBias)
      }

      let ratedSum = 0
      let ratedN = 0
      for (let i = 0; i < n; i++) if (weights[i] >= 1) { ratedSum += ratings[i]; ratedN++ }

      return {
        p, bias, n: ratedN || n, rated: byId, weights, rows, targets, inverse,
        mean: ratedN ? ratedSum / ratedN : ratings.reduce((a, b) => a + b, 0) / n,
      }
    },

    /** The crowd score of one title for you (see rankAll), or null if unknown. */
    score(user, id, mix = DEFAULT_MIX) {
      const m = load()
      const row = m?.index.get(Number(id))
      if (!user || row == null) return null
      return scoreRow(m, user, row, { ...DEFAULT_MIX, ...mix })
    },

    /**
     * Every title in the model, scored for you.
     *
     * Two things go into the score and they are kept apart on purpose:
     *
     *   lift  — how much more people with your taste like it than the average
     *           reader does. This is the personal part, and it leads.
     *   bias  — how much better than average everyone thinks it is. A quality
     *           prior, no more; on its own it would hand back the usual canon.
     *
     * Fame is then charged for explicitly. The famous titles are the ones you
     * have most likely already met and simply not logged, and a list of them
     * is not a discovery — `popularity` is the cost per tenfold increase in
     * raters beyond `familiar`, which is about the level of a typical library.
     */
    rankAll(user, { limit = 200, exclude = null, minRatings = 300, ...mix } = {}) {
      const m = load()
      if (!m || !user) return []
      const settings = { ...DEFAULT_MIX, ...mix }
      const out = []
      for (let row = 0; row < m.count; row++) {
        if (m.n[row] < minRatings) continue
        const id = m.ids[row]
        if (user.rated.has(id) || exclude?.has(id)) continue
        out.push(scoreRow(m, user, row, settings))
      }
      out.sort((a, b) => b.score - a.score)
      return out.slice(0, limit)
    },

    /**
     * Which of your own titles a suggestion rests on.
     *
     * Your vector is a weighted sum of the vectors of what you rated, so a
     * prediction is, exactly, a sum of one term per title of yours — and the
     * terms are signed: something you rated below what the model expected
     * pulls its neighbours down. This hands back the largest positive terms
     * among the things you rated well, which is a reason you can check
     * against your own memory ("because you rated Fargo ★★★★½").
     */
    because(user, id, { limit = 3 } = {}) {
      const m = load()
      const row = m?.index.get(Number(id))
      if (!user?.inverse || row == null) return []
      const { k, Q } = m

      // v = A⁻¹ q_candidate, so each title's term is target_j · (v · q_j).
      const v = new Float64Array(k)
      const base = row * k
      for (let f = 0; f < k; f++) {
        let s = 0
        for (let g = 0; g < k; g++) s += user.inverse[f * k + g] * Q[base + g]
        v[f] = s
      }
      const terms = []
      for (let i = 0; i < user.rows.length; i++) {
        /*
         * Only titles you rated — not merely logged — and rated well, both
         * in absolute terms and against what was expected of you. Something
         * you hated also pushes its opposites up ("you gave Green Lantern one
         * star, so Parasite"), which is true, and no use to anyone as a
         * reason; and "you gave The Human Centipede three and a half, which
         * is more than expected" is not a recommendation either.
         */
        if (user.weights[i] < 1 || user.targets[i] <= 0) continue
        const itemId = m.ids[user.rows[i]]
        const rating = user.rated.get(itemId)
        if (rating < Math.max(4, user.mean + 0.25)) continue
        const other = user.rows[i] * k
        let dot = 0
        for (let f = 0; f < k; f++) dot += v[f] * Q[other + f]
        const term = user.targets[i] * dot
        if (term <= 0) continue
        terms.push({ item_id: itemId, rating, term })
      }
      terms.sort((a, b) => b.term - a.term)
      return terms.slice(0, limit)
    },
  }
}

export const film = createModel('cf.db')
export const books = createModel('cf-books.db')

/** Is any model built? */
export function available() {
  return film.available() || books.available()
}

export function info() {
  return { film: film.info(), books: books.info() }
}
