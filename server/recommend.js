import { all, get, run, json } from './lib/db.js'
import { normaliseTitle, decade, uniqueBy, clamp } from './lib/util.js'
import { tmdb, itunes, ol, mb, tvmaze, wiki } from './providers/index.js'
import * as wikidata from './providers/wikidata.js'

/* ------------------------------------------------------------------ profile */

// How much each kind of attribute is allowed to move a score.
const KIND_WEIGHT = {
  creator: 1.0,
  genre: 0.75,
  keyword: 0.5,
  decade: 0.3,
  lang: 0.25,
}

const RECENCY_HALF_LIFE_YEARS = 5
const SHRINK = 2          // pulls thin evidence towards neutral
const IMPLICIT_WEIGHT = 0.45

function attrsOf(work) {
  const out = []
  for (const g of work.genres || []) {
    out.push({ key: `genre:${String(g).toLowerCase()}`, weight: 1, display: String(g) })
  }
  for (const c of work.creators || []) {
    if (!c?.name) continue
    // "You like HBO" is not a useful reason to watch something.
    if (c.role === 'Network' || c.role === 'Publisher') continue
    // Cast members are weak signal compared with the authoring roles.
    out.push({
      key: `creator:${c.role || 'Creator'}|${String(c.name).toLowerCase()}`,
      weight: c.role === 'Cast' ? 0.4 : 1,
      display: String(c.name),
    })
  }
  for (const k of (work.metadata?.keywords || []).slice(0, 10)) {
    out.push({ key: `keyword:${String(k).toLowerCase()}`, weight: 0.9, display: String(k) })
  }
  const dec = decade(work.year)
  if (dec) out.push({ key: `decade:${dec}`, weight: 1, display: dec })
  if (work.language) out.push({ key: `lang:${String(work.language).toLowerCase()}`, weight: 1, display: String(work.language) })
  return out
}

function recencyWeight(dateStr) {
  if (!dateStr) return 0.7
  const years = (Date.now() - new Date(dateStr).getTime()) / (365.25 * 24 * 3600 * 1000)
  if (!Number.isFinite(years) || years < 0) return 1
  return 0.45 + 0.55 * Math.pow(0.5, years / RECENCY_HALF_LIFE_YEARS)
}

/**
 * Turn the log into a taste profile: for every genre, creator, decade and
 * keyword, how far above or below your own average you rate it.
 */
export function buildProfile() {
  const rows = all(`
    SELECT w.id, w.type, w.title, w.year, w.genres, w.creators, w.language, w.metadata,
           e.rating, e.liked, e.consumed_on, e.id AS entry_id
    FROM entries e JOIN works w ON w.id = e.work_id
    ORDER BY ifnull(e.consumed_on, e.created_at) DESC`)

  const works = rows.map((r) => ({
    ...r,
    genres: json(r.genres, []),
    creators: json(r.creators, []),
    metadata: json(r.metadata, {}),
  }))

  const ratedByType = {}
  for (const w of works) {
    if (w.rating == null) continue
    ;(ratedByType[w.type] ||= []).push(w.rating)
  }
  const meanByType = {}
  for (const [type, list] of Object.entries(ratedByType)) {
    meanByType[type] = list.reduce((a, b) => a + b, 0) / list.length
  }
  const allRated = Object.values(ratedByType).flat()
  const globalMean = allRated.length ? allRated.reduce((a, b) => a + b, 0) / allRated.length : 3.5

  const attrs = new Map()
  const seen = new Set()

  for (const w of works) {
    const mean = meanByType[w.type] ?? globalMean
    let dev
    let weight = recencyWeight(w.consumed_on)

    if (w.rating != null) {
      dev = w.rating - mean
      if (w.liked) dev += 0.25
    } else if (w.metadata?.play_count) {
      // Music arrives without stars: heavy rotation is the rating.
      dev = clamp(Math.log10(w.metadata.play_count) - 0.6, -0.5, 1.2)
      weight *= IMPLICIT_WEIGHT
    } else if (w.liked) {
      dev = 0.5
      weight *= IMPLICIT_WEIGHT
    } else {
      continue
    }

    for (const { key, weight: aw, display } of attrsOf(w)) {
      const slot = attrs.get(key) || { key, display, sum: 0, weightSum: 0, n: 0, support: [], types: new Set() }
      slot.sum += dev * weight * aw
      slot.weightSum += weight * aw
      slot.n += 1
      slot.types.add(w.type)
      const dedupeKey = `${key}|${w.id}`
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey)
        slot.support.push({ id: w.id, title: w.title, rating: w.rating, year: w.year, type: w.type, dev })
      }
      attrs.set(key, slot)
    }
  }

  for (const slot of attrs.values()) {
    slot.score = slot.sum / (slot.weightSum + SHRINK)
    slot.confidence = slot.n / (slot.n + SHRINK)
    slot.support.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    slot.support = slot.support.slice(0, 5)
    slot.types = [...slot.types]
  }

  const list = [...attrs.values()]
  const pickTop = (prefix, minN) => list
    .filter((a) => a.key.startsWith(prefix) && a.n >= minN && a.score > 0)
    .sort((a, b) => b.score * b.confidence - a.score * a.confidence)

  return {
    attrs,
    globalMean,
    meanByType,
    counts: {
      entries: works.length,
      rated: allRated.length,
      works: new Set(works.map((w) => w.id)).size,
    },
    topCreators: pickTop('creator:', 2).slice(0, 25),
    topGenres: pickTop('genre:', 2).slice(0, 20),
    topKeywords: pickTop('keyword:', 2).slice(0, 20),
    topDecades: pickTop('decade:', 3).slice(0, 5),
    favourites: works
      .filter((w) => w.rating != null && w.rating >= Math.max(4, (meanByType[w.type] ?? globalMean) + 0.5))
      .slice(0, 60),
    // Music usually arrives unrated: heavy rotation is the only signal there is.
    mostPlayed: works
      .filter((w) => (w.metadata?.play_count || 0) > 0)
      .sort((a, b) => (b.metadata.play_count || 0) - (a.metadata.play_count || 0))
      .slice(0, 25),
  }
}

export function profileFingerprint() {
  const row = get(`SELECT count(*) n, ifnull(max(updated_at),'') u, ifnull(sum(rating),0) s FROM entries`)
  return `${row.n}|${row.u}|${row.s}`
}

/* ----------------------------------------------------- candidate generation */

function parseCreatorKey(key) {
  const [role, name] = key.replace('creator:', '').split('|')
  return { role: role || 'Creator', name }
}

const ROLE_FOR_TYPE = {
  film: ['Director'],
  tv: ['Creator', 'Director'],
  book: ['Author'],
  audiobook: ['Author', 'Narrator'],
  album: ['Artist'],
  game: ['Developer'],
  podcast: ['Publisher'],
}

async function candidatesForType(type, profile, { breadth = 1 } = {}) {
  const out = []
  const roles = ROLE_FOR_TYPE[type] || ['Creator']
  const creators = profile.topCreators
    .filter((c) => c.types.includes(type) && roles.includes(parseCreatorKey(c.key).role))
    .slice(0, Math.round(6 * breadth))
  const genres = profile.topGenres.filter((g) => g.types.includes(type)).slice(0, Math.round(4 * breadth))
  const seedWorks = [
    ...profile.favourites.filter((w) => w.type === type),
    ...(profile.mostPlayed || []).filter((w) => w.type === type),
  ].slice(0, Math.round(10 * breadth))

  const seeds = uniqueBy(seedWorks, (w) => w.id)
  const push = (items, via, seed, attrKey, label, role) => {
    for (const item of items || []) {
      if (!item || !item.title) continue
      // Candidates found via a person must carry that person: the diversity
      // pass counts creators, and the card needs a byline.
      const creators = item.creators?.length
        ? item.creators
        : (via === 'creator' && label ? [{ role: role || 'Creator', name: label }] : [])
      out.push({ ...item, creators, type: item.type || type, via: [{ via, seed, attrKey, label }] })
    }
  }

  if ((type === 'film' || type === 'tv') && tmdb.hasKey()) {
    for (const seed of seeds) {
      const work = get('SELECT tmdb_id FROM works WHERE id = ?', seed.id)
      if (!work?.tmdb_id) continue
      push(await tmdb.recommendations(type, work.tmdb_id, 12), 'similar', seed)
    }
    const genreIds = uniqueBy(
      genres.flatMap((g) => {
        const support = g.support[0]
        const meta = support ? json(get('SELECT metadata FROM works WHERE id = ?', support.id)?.metadata, {}) : {}
        return (meta.genre_ids || []).map((id) => ({ id, attrKey: g.key }))
      }),
      (x) => x.id,
    ).slice(0, 3)
    if (genreIds.length) {
      push(await tmdb.discover(type, { genreIds: genreIds.map((g) => g.id), limit: 24 }), 'genre', null, genreIds[0].attrKey)
    }
  }

  if (type === 'tv' && !tmdb.hasKey()) {
    for (const g of genres.slice(0, 2)) {
      const name = g.key.replace('genre:', '')
      push(await tvmaze.byGenre(name, { limit: 18 }), 'genre', g.support[0], g.key, g.display)
    }
  }

  if (type === 'book' || type === 'audiobook') {
    for (const c of creators) {
      const { name } = parseCreatorKey(c.key)
      const support = c.support[0]
      const meta = support ? json(get('SELECT metadata FROM works WHERE id = ?', support.id)?.metadata, {}) : {}
      const authorKey = (meta.author_keys || [])[0]
      const byAuthor = authorKey
        ? await ol.byAuthorKey(authorKey, { limit: 14, type })
        : await ol.search(name, { limit: 10, type, author: name })
      push(byAuthor, 'creator', support, c.key, c.display || name, 'Author')
      if (type === 'audiobook') push(await itunes.search('audiobook', name, 8), 'creator', support, c.key, c.display || name, 'Author')
    }
    for (const g of genres.slice(0, 3)) {
      push(await ol.bySubject(g.display || g.key.replace('genre:', ''), { limit: 14, type }), 'genre', g.support[0], g.key, g.display)
    }
  }

  if (type === 'album' || type === 'track') {
    // One album per artist is normal in music, so seed from the artists behind
    // your best-rated and most-played records rather than waiting for n >= 2.
    const seedArtists = uniqueBy(
      [
        ...creators.map((c) => ({ name: c.display || parseCreatorKey(c.key).name, support: c.support[0] })),
        ...seeds.map((w) => {
          const row = get('SELECT creators, metadata FROM works WHERE id = ?', w.id)
          const artist = json(row?.creators, []).find((c) => c.role === 'Artist')
          return artist ? { name: artist.name, support: w, metadata: json(row?.metadata, {}) } : null
        }).filter(Boolean),
      ],
      (a) => a.name.toLowerCase(),
    ).slice(0, Math.round(8 * breadth))

    for (const artist of seedArtists) {
      const meta = artist.metadata
        || (artist.support ? json(get('SELECT metadata FROM works WHERE id = ?', artist.support.id)?.metadata, {}) : {})
      const key = `creator:Artist|${artist.name.toLowerCase()}`
      if (meta?.artist_id) push(await itunes.byArtist('album', meta.artist_id, 12), 'creator', artist.support, key, artist.name, 'Artist')
      else push(await itunes.search('album', artist.name, 8), 'creator', artist.support, key, artist.name, 'Artist')
    }
    // MusicBrainz tags are real genre data; an iTunes text search for "Alternative" is not.
    for (const g of genres.slice(0, 3)) {
      push(await mb.byTag(g.display || g.key.replace('genre:', ''), 16), 'genre', g.support[0], g.key, g.display)
    }
  }

  if (type === 'podcast') {
    for (const g of genres.slice(0, 3)) {
      push(await itunes.search('podcast', g.display || g.key.replace('genre:', ''), 10), 'genre', g.support[0], g.key, g.display)
    }
  }

  // Keyless film/TV/game: Wikidata knows the full catalogue of everyone you rate highly.
  if ((type === 'film' && !tmdb.hasKey()) || type === 'game' || (type === 'tv' && !tmdb.hasKey())) {
    for (const c of creators.slice(0, 5)) {
      const { role, name } = parseCreatorKey(c.key)
      const entity = await wikidata.findEntity(name, type)
      if (!entity) continue
      const works = await wikidata.worksBy(entity.qid, type, { role, limit: 25 })
      push(works, 'creator', c.support[0], c.key, c.display || name, role)
    }
  }

  return out
}

/* ------------------------------------------------------------------ scoring */

function candidateAttrs(c) {
  return attrsOf({
    genres: c.genres,
    creators: c.creators,
    year: c.year,
    language: c.language,
    metadata: c.metadata,
  })
}

const STAR = (n) => (n == null ? '' : '★'.repeat(Math.floor(n)) + (n % 1 ? '½' : ''))

function explain(candidate, profile, contributions) {
  const bits = []
  const creatorVia = candidate.via.find((v) => v.via === 'creator' && v.seed)
  const similarVia = candidate.via.find((v) => v.via === 'similar' && v.seed)

  if (similarVia) {
    bits.push(`Similar to ${similarVia.seed.title}${similarVia.seed.rating ? ` (${STAR(similarVia.seed.rating)})` : ''}`)
  }
  if (creatorVia) {
    const name = creatorVia.label || parseCreatorKey(creatorVia.attrKey || 'creator:Creator|').name
    const seed = creatorVia.seed
    bits.push(seed
      ? `More from ${name} — you gave ${seed.title} ${STAR(seed.rating) || 'a high rating'}`
      : `More from ${name}`)
  }
  for (const c of contributions.slice(0, 4)) {
    if (bits.length >= 2) break
    if (c.key.startsWith('creator:') && creatorVia) continue
    // Decades are a weak signal: only mention one if nothing better turned up.
    if (c.key.startsWith('decade:') && contributions.some((x) => x !== c && x.contribution > 0 && !x.key.startsWith('decade:'))) continue
    const label = c.slot.display || c.key.split(':').pop()
    if (c.key.startsWith('genre:')) {
      const top = c.slot.support[0]
      bits.push(`You rate ${label} ${c.slot.score > 0 ? 'above' : 'below'} your average${top ? ` (${top.title} ${STAR(top.rating)})` : ''}`)
    } else if (c.key.startsWith('creator:')) {
      bits.push(`You like ${label}`)
    } else if (c.key.startsWith('keyword:')) {
      bits.push(`You go for ${label}`)
    } else if (c.key.startsWith('decade:')) {
      bits.push(`${label} is a sweet spot for you`)
    }
  }
  return uniqueBy(bits, (b) => b.slice(0, 20)).slice(0, 2)
}

function excluded() {
  const logged = new Set(
    all('SELECT DISTINCT w.type, w.title FROM works w JOIN entries e ON e.work_id = w.id')
      .map((r) => `${r.type}|${normaliseTitle(r.title)}`),
  )
  for (const r of all("SELECT ifnull(type,'') type, title FROM recs WHERE status IN ('open','dismissed','done')")) {
    logged.add(`${r.type}|${normaliseTitle(r.title)}`)
  }
  for (const r of all('SELECT fingerprint FROM rec_blocks')) logged.add(r.fingerprint)
  return logged
}

/** Score, explain and diversify. */
export function rank(candidates, profile, { limit = 12 } = {}) {
  const skip = excluded()
  const merged = new Map()

  for (const c of candidates) {
    const fp = `${c.type}|${normaliseTitle(c.title)}`
    if (skip.has(fp)) continue
    const prev = merged.get(fp)
    if (prev) {
      prev.via.push(...c.via)
      // Keep whichever copy carries more metadata.
      if (!prev.poster_url && c.poster_url) prev.poster_url = c.poster_url
      if (!prev.overview && c.overview) prev.overview = c.overview
      if ((c.genres || []).length > (prev.genres || []).length) prev.genres = c.genres
      if ((c.creators || []).length > (prev.creators || []).length) prev.creators = c.creators
      continue
    }
    merged.set(fp, { ...c, fingerprint: fp })
  }

  const scored = []
  for (const c of merged.values()) {
    let score = 0
    const contributions = []
    for (const { key, weight } of candidateAttrs(c)) {
      const slot = profile.attrs.get(key)
      if (!slot) continue
      const kind = key.split(':')[0]
      // A genre learnt from your TV ratings should nudge, not drive, a book pick.
      const crossMedia = slot.types.includes(c.type) ? 1 : 0.4
      const contribution = slot.score * slot.confidence * (KIND_WEIGHT[kind] ?? 0.4) * weight * crossMedia
      score += contribution
      contributions.push({ key, slot, contribution })
    }

    // Provenance bonus: an explicit "similar to something you loved" is strong.
    for (const v of c.via) {
      if (v.via === 'similar' && v.seed?.rating) score += 0.35 * (v.seed.rating - (profile.meanByType[c.type] ?? profile.globalMean))
      if (v.via === 'creator' && v.seed?.rating) score += 0.2 * (v.seed.rating - (profile.meanByType[c.type] ?? profile.globalMean))
    }
    // Mild quality prior so obscure dross does not outrank good matches.
    if (c.external_rating) score += 0.3 * (c.external_rating / 10 - 0.62)
    if (c.popularity) score += 0.06 * Math.min(2, Math.log10(1 + c.popularity))
    if (!c.poster_url) score -= 0.05

    contributions.sort((a, b) => b.contribution - a.contribution)
    scored.push({ ...c, score, contributions, reasons: explain(c, profile, contributions) })
  }

  scored.sort((a, b) => b.score - a.score)

  // Diversify: do not hand back six films by one director.
  const picked = []
  const creatorCount = new Map()
  const genreCount = new Map()
  const pool = scored.slice(0, Math.max(limit * 8, 80))

  while (picked.length < limit && pool.length) {
    let bestIdx = -1
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]
      let penalty = 1
      for (const cr of c.creators || []) {
        const n = creatorCount.get(String(cr.name).toLowerCase()) || 0
        if (n) penalty *= Math.pow(0.4, n)
      }
      for (const g of (c.genres || []).slice(0, 3)) {
        const n = genreCount.get(String(g).toLowerCase()) || 0
        if (n >= 2) penalty *= 0.8
      }
      const adjusted = c.score * penalty
      if (adjusted > bestScore) { bestScore = adjusted; bestIdx = i }
    }
    if (bestIdx < 0) break
    const [chosen] = pool.splice(bestIdx, 1)
    picked.push({ ...chosen, adjustedScore: bestScore })
    for (const cr of chosen.creators || []) {
      const k = String(cr.name).toLowerCase()
      creatorCount.set(k, (creatorCount.get(k) || 0) + 1)
    }
    for (const g of (chosen.genres || []).slice(0, 3)) {
      const k = String(g).toLowerCase()
      genreCount.set(k, (genreCount.get(k) || 0) + 1)
    }
  }

  return picked
}

/** Put artwork on the final shortlist (one batched request for Wikidata picks). */
async function hydrateArtwork(picks) {
  const needs = picks.filter((p) => !p.poster_url && p.metadata?.wikipedia_title)
  if (needs.length) {
    const map = await wiki.batchPageImages(needs.map((p) => p.metadata.wikipedia_title))
    for (const p of needs) {
      const info = map.get(p.metadata.wikipedia_title)
      if (info?.poster_url) {
        p.poster_url = info.poster_url
        p.backdrop_url = info.backdrop_url
        if (!p.overview) p.overview = info.overview
      }
    }
  }
  // Anything still bare: one targeted search each, capped so this stays quick.
  const stillBare = picks.filter((p) => !p.poster_url).slice(0, 6)
  for (const p of stillBare) {
    const hits = await wiki.search(p.type, `${p.title} ${p.year || ''}`.trim(), 3)
    const hit = hits.find((h) => normaliseTitle(h.title) === normaliseTitle(p.title)) || hits[0]
    if (hit?.poster_url) {
      p.poster_url = hit.poster_url
      p.backdrop_url = hit.backdrop_url
      if (!p.overview) p.overview = hit.overview
    }
  }
  return picks
}

/* ------------------------------------------------------------------- public */

const CACHE_TTL_MS = 12 * 60 * 60 * 1000

export async function recommend(type, { limit = 12, force = false, breadth = 1 } = {}) {
  const fingerprint = profileFingerprint()
  const cached = get('SELECT * FROM rec_cache WHERE type = ? ORDER BY id DESC LIMIT 1', type)
  if (!force && cached) {
    const payload = json(cached.payload, null)
    const age = Date.now() - new Date(cached.computed_at + 'Z').getTime()
    if (payload && payload.fingerprint === fingerprint && age < CACHE_TTL_MS) {
      return { ...payload, cached: true }
    }
  }

  const profile = buildProfile()
  const ratedOfType = (profile.meanByType[type] != null)
  if (!ratedOfType && !profile.counts.rated) {
    return { type, fingerprint, picks: [], profileThin: true, cached: false }
  }

  const candidates = await candidatesForType(type, profile, { breadth })
  const picks = await hydrateArtwork(rank(candidates, profile, { limit }))

  const payload = {
    type,
    fingerprint,
    computed_at: new Date().toISOString(),
    candidateCount: candidates.length,
    usingTmdb: tmdb.hasKey(),
    picks: picks.map((p) => ({
      type: p.type,
      title: p.title,
      year: p.year,
      creators: (p.creators || []).slice(0, 4),
      genres: (p.genres || []).slice(0, 4),
      overview: p.overview || null,
      poster_url: p.poster_url || null,
      backdrop_url: p.backdrop_url || null,
      external_rating: p.external_rating ?? null,
      score: Math.round(p.score * 1000) / 1000,
      reasons: p.reasons,
      fingerprint: p.fingerprint,
      ids: {
        tmdb_id: p.tmdb_id || null,
        imdb_id: p.imdb_id || null,
        isbn: p.isbn || null,
        olid: p.olid || null,
        itunes_id: p.itunes_id || null,
        mbid: p.mbid || null,
      },
      provider: p.provider || null,
    })),
  }

  run('DELETE FROM rec_cache WHERE type = ?', type)
  run("INSERT INTO rec_cache (type, payload, computed_at) VALUES (?, ?, datetime('now'))", type, JSON.stringify(payload))
  return { ...payload, cached: false }
}

export function blockRecommendation(fingerprint, reason) {
  run('INSERT OR REPLACE INTO rec_blocks (fingerprint, reason) VALUES (?, ?)', fingerprint, reason || null)
}

/** The "your taste, in numbers" panel. */
export function profileSummary() {
  const p = buildProfile()
  const fmt = (list, label) => list.slice(0, 8).map((a) => ({
    label: a.display || (a.key.includes('|') ? a.key.split('|')[1] : a.key.split(':')[1]),
    role: a.key.startsWith('creator:') ? a.key.replace('creator:', '').split('|')[0] : label,
    score: Math.round(a.score * 100) / 100,
    n: a.n,
    support: a.support.map((s) => ({ id: s.id, title: s.title, rating: s.rating })),
  }))
  return {
    counts: p.counts,
    globalMean: Math.round(p.globalMean * 100) / 100,
    meanByType: Object.fromEntries(Object.entries(p.meanByType).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    creators: fmt(p.topCreators, 'creator'),
    genres: fmt(p.topGenres, 'genre'),
    keywords: fmt(p.topKeywords, 'keyword'),
    decades: fmt(p.topDecades, 'decade'),
    favourites: p.favourites.slice(0, 12).map((f) => ({ id: f.id, title: f.title, rating: f.rating, type: f.type, year: f.year })),
  }
}
