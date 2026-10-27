import { all, get, run, json } from './lib/db.js'
import { normaliseTitle, decade, uniqueBy, clamp } from './lib/util.js'
import { systemUserId } from './lib/user.js'
import { tmdb, itunes, ol, mb, tvmaze, wiki, bookNoise } from './providers/index.js'
import * as wikidata from './providers/wikidata.js'
import * as cf from './lib/cf.js'

/* ------------------------------------------------------------------ profile */

// How much each kind of attribute is allowed to move a score.
const KIND_WEIGHT = {
  creator: 1.0,
  genre: 0.75,
  // Keywords are the sharpest signal there is once candidates actually carry
  // them: "dark comedy" and "gangster" separate films that share a genre.
  keyword: 0.7,
  // A decade matches almost everything you are shown, so it adds roughly the
  // same amount to every candidate and decides nothing. It stays only to
  // break ties and to colour an explanation.
  decade: 0.12,
  lang: 0.15,
}

/*
 * The floor below which a film or show is not worth suggesting at all.
 *
 * This is not taste, it is noise removal: TMDB's "recommended" tails are full
 * of titles with a handful of votes, and a 5.2-rated obscurity has no business
 * outranking a good match however many of your favourites it is adjacent to.
 */
const QUALITY = {
  film: { minVotes: 200, minRating: 6.0 },
  tv: { minVotes: 80, minRating: 6.2 },
}

/*
 * Subjects that mean "this is for a small child". Open Library returns board
 * books alongside literary fiction for the same subject search, and a
 * recommendation of "Guess How Much I Love You" to someone reading Sanderson
 * is the kind of thing that makes the whole feature look broken.
 */
const JUVENILE = /juvenile|picture book|board book|children's|toddler|baby|preschool|early reader/i

/*
 * A reference work is not a reading recommendation, and a subject naming a
 * language other than English marks a foreign edition. Both turn up through
 * Open Library's author index, which is loose enough that a Spanish symbols
 * dictionary is credited to Philip Pullman — he wrote a foreword to one
 * edition, so the attribution check cannot catch it.
 */
const REFERENCE = /^(dictionar|encyclop|glossar|thesaur|textbook|bibliograph|concordance|almanac|atlas|catalog)/i
const OTHER_LANGUAGE = /^(spanish|french|german|italian|portuguese|dutch|polish|russian|chinese|japanese|turkish|swedish|danish|norwegian|finnish|czech|hungarian|romanian|catalan|greek|hebrew|arabic|korean|ukrainian|latin)$/i

function passesQuality(c, profile) {
  if (c.type === 'book' || c.type === 'audiobook') {
    if (c.language && String(c.language).toLowerCase() !== 'eng') return false

    /*
     * The same hangers-on that clutter book search clutter suggestions:
     * summaries, study guides, box sets, companions. Nobody wants "Summary of
     * Project Hail Mary" recommended to them.
     */
    if (bookNoise(c.title)) return false

    const subjects = (c.genres || []).map((g) => String(g).trim())
    if (subjects.some((g) => REFERENCE.test(g))) return false
    if (subjects.some((g) => OTHER_LANGUAGE.test(g))) return false

    const ratings = c.metadata?.ratings_count ?? 0

    /*
     * Something nobody has catalogued twice and nobody has rated is not a
     * book anyone is looking for — it is a shop's display pack or a one-off
     * edition record. Real books accumulate editions.
     */
    const editions = c.popularity ?? 0
    if (editions < 2 && ratings < 3) return false

    // Open Library's own rating, already on a 0–10 scale here.
    if (ratings >= 8 && (c.external_rating ?? 10) < 6.4) return false

    const juvenile = (c.genres || []).some((g) => JUVENILE.test(String(g)))
    if (juvenile) {
      // Unless you actually read children's books, in which case keep them.
      const readsJuvenile = [...(profile?.attrs?.keys() || [])]
        .some((k) => k.startsWith('genre:') && JUVENILE.test(k) && (profile.attrs.get(k)?.n ?? 0) >= 3)
      if (!readsJuvenile) return false
    }
    return true
  }

  const bar = QUALITY[c.type]
  if (!bar) return true
  const votes = c.metadata?.vote_count ?? 0
  // No vote data at all means it did not come from TMDB; judge it elsewhere.
  if (!votes && c.external_rating == null) return true
  if (votes < bar.minVotes) return false
  if ((c.external_rating ?? 0) < bar.minRating) return false
  return true
}

const RECENCY_HALF_LIFE_YEARS = 5
/*
 * Shrinkage, and how much evidence an attribute needs before it is allowed to
 * drive anything. With these set too low the engine chased noise: three films
 * tagged "Male friendship" outranked two hundred tagged Drama.
 */
const SHRINK = 6
const CONFIDENCE_K = 8    // confidence = n / (n + K)
const MIN_SUPPORT = 4     // below this an attribute can explain, but not drive
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
      // Sharing an actor rarely means two films are alike; sharing a director
      // usually does. Cast stays in so it can explain a pick, not choose one.
      weight: c.role === 'Cast' ? 0.12 : 1,
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
    slot.confidence = slot.n / (slot.n + CONFIDENCE_K)
    slot.support.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    slot.support = slot.support.slice(0, 5)
    slot.types = [...slot.types]
  }

  const list = [...attrs.values()]
  const pickTop = (prefix, minN) => list
    .filter((a) => a.key.startsWith(prefix) && a.n >= Math.max(minN, MIN_SUPPORT) && a.score > 0)
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

/**
 * What people who rated your films the way you did went on to rate highly.
 *
 * This is the collaborative part, and it is the strongest signal available:
 * it knows nothing about genres or directors, only that thirty thousand people
 * who loved Fargo also loved Goodfellas. Everything else in here is a guess
 * about *why* you might like something; this is evidence that you will.
 */
export function crowdScores(type, profile) {
  if (type !== 'film' && type !== 'tv') return null
  if (!cf.available()) return null

  const rated = all(
    `SELECT w.tmdb_id, max(e.rating) rating
       FROM works w JOIN entries e ON e.work_id = w.id
      WHERE w.type = ? AND w.tmdb_id IS NOT NULL AND e.rating IS NOT NULL
      GROUP BY w.tmdb_id`,
    type,
  )
  if (rated.length < 5) return null

  const mean = profile.meanByType[type] ?? profile.globalMean
  const scores = cf.scoreNeighbours(rated, mean)
  return scores.size ? scores : null
}

async function candidatesForType(type, profile, { breadth = 1, crowd = null } = {}) {
  const out = []
  const roles = ROLE_FOR_TYPE[type] || ['Creator']
  const creators = profile.topCreators
    .filter((c) => {
      const { role } = parseCreatorKey(c.key)
      return c.types.includes(type) && roles.includes(role) && role !== 'Cast'
    })
    .slice(0, Math.round(6 * breadth))
  const genres = profile.topGenres.filter((g) => g.types.includes(type)).slice(0, Math.round(4 * breadth))
  /*
   * Seeds. With 44 favourites to draw on, taking ten of them left a pool of
   * barely a hundred candidates — so the engine was choosing the best of a
   * near-random handful rather than the best of everything plausible.
   */
  const seedWorks = [
    ...profile.favourites.filter((w) => w.type === type),
    ...(profile.mostPlayed || []).filter((w) => w.type === type),
  ].slice(0, Math.round(24 * breadth))

  /*
   * With nothing of this type rated yet there are no favourites, and the
   * engine used to return an empty list. But a shelf is a choice in itself:
   * fall back to what you have most recently logged, which is at least
   * evidence of what you pick up.
   */
  const fallback = seedWorks.length === 0
    ? all(
      `SELECT w.id, w.type, w.title, w.year, e.rating
         FROM works w JOIN entries e ON e.work_id = w.id
        WHERE w.type = ?
        ORDER BY ifnull(e.consumed_on, e.created_at) DESC
        LIMIT ?`,
      type, Math.round(16 * breadth),
    )
    : []

  const seeds = uniqueBy([...seedWorks, ...fallback], (w) => w.id)
  /*
   * Attribution has to be earned, not assumed.
   *
   * This used to stamp the seed person's name onto any result that arrived
   * without credits, so that the card had a byline — which is how a Spanish
   * dictionary ended up recommended as "More from Philip Pullman". Open
   * Library's author index is not reliable enough for that. Now a result from
   * a person-specific lookup has to actually name that person, or it loses the
   * provenance that put it there.
   */
  const namesMatch = (creators, label) => {
    if (!label) return false
    const want = String(label).toLowerCase()
    const surname = want.split(/\s+/).pop()
    return (creators || []).some((c) => {
      const name = String(c?.name || '').toLowerCase()
      return name === want || (surname.length > 2 && name.includes(surname))
    })
  }

  const push = (items, via, seed, attrKey, label, role) => {
    for (const item of items || []) {
      if (!item || !item.title) continue

      if (via === 'creator' && label) {
        const credited = item.creators?.length
        if (credited && !namesMatch(item.creators, label)) continue
        if (!credited) {
          // No credits at all from a by-person lookup: keep it, but do not
          // claim who made it.
          out.push({ ...item, creators: [], type: item.type || type, via: [{ via: 'genre', seed, attrKey, label: null }] })
          continue
        }
      }

      out.push({
        ...item,
        creators: item.creators || [],
        type: item.type || type,
        via: [{ via, seed, attrKey, label }],
      })
    }
  }

  // The crowd's picks come first, and carry the most weight.
  if (crowd && tmdb.hasKey()) {
    const best = [...crowd.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, Math.round(70 * breadth))

    const BATCH = 4
    for (let i = 0; i < best.length; i += BATCH) {
      const slice = best.slice(i, i + BATCH)
      const filled = await Promise.all(slice.map(([tmdbId]) => tmdb.detail(type, String(tmdbId)).catch(() => null)))
      for (let j = 0; j < filled.length; j++) {
        if (!filled[j]) continue
        const [tmdbId, slot] = slice[j]
        const seed = slot.from[0]
          ? get('SELECT id, title, year FROM works WHERE tmdb_id = ? LIMIT 1', String(slot.from[0].tmdb_id))
          : null
        out.push({
          ...filled[j],
          type,
          via: [{
            via: 'crowd',
            seed: seed ? { ...seed, type, rating: slot.from[0].rating } : null,
            attrKey: null,
            label: null,
            agreed: slot.from.length,
          }],
        })
      }
    }
  }

  if ((type === 'film' || type === 'tv') && tmdb.hasKey()) {
    // Both lists: "recommendations" is behavioural (what people who liked this
    // also liked), "similar" is content-based. They overlap, and a title in
    // both from several seeds is exactly what we are looking for.
    for (const seed of seeds) {
      const work = get('SELECT tmdb_id FROM works WHERE id = ?', seed.id)
      if (!work?.tmdb_id) continue
      push(await tmdb.recommendations(type, work.tmdb_id, 20), 'similar', seed)
      push(await tmdb.similar(type, work.tmdb_id, 12), 'similar', seed)
    }

    const genreIds = uniqueBy(
      genres.flatMap((g) => {
        const support = g.support[0]
        const meta = support ? json(get('SELECT metadata FROM works WHERE id = ?', support.id)?.metadata, {}) : {}
        return (meta.genre_ids || []).map((id) => ({ id, attrKey: g.key }))
      }),
      (x) => x.id,
    ).slice(0, 4)

    // Well-regarded titles in the genres you rate highly, and in the decades
    // you favour — the part of the catalogue you have not got to yet.
    if (genreIds.length) {
      push(await tmdb.discover(type, { genreIds: genreIds.map((g) => g.id), limit: 30 }), 'genre', null, genreIds[0].attrKey)
      for (const dec of (profile.topDecades || []).slice(0, 2)) {
        const from = Number(String(dec.display || dec.key.split(':')[1]).replace(/\D/g, ''))
        if (!from) continue
        push(
          await tmdb.discover(type, {
            genreIds: genreIds.slice(0, 2).map((g) => g.id),
            yearFrom: from, yearTo: from + 9, limit: 20,
          }),
          'genre', dec.support?.[0], dec.key, dec.display,
        )
      }
    }

    // And the people whose work you rate above your own average.
    for (const c of creators.slice(0, 6)) {
      const { name } = parseCreatorKey(c.key)
      const byPerson = await tmdb.personWorks(name, type, { limit: 14 }).catch(() => [])
      push(byPerson, 'creator', c.support[0], c.key, name)
    }
  }

  if (type === 'tv' && !tmdb.hasKey()) {
    for (const g of genres.slice(0, 2)) {
      const name = g.key.replace('genre:', '')
      push(await tvmaze.byGenre(name, { limit: 18 }), 'genre', g.support[0], g.key, g.display)
    }
  }

  if (type === 'book' || type === 'audiobook') {
    /*
     * Authors you rate highly are the strongest book signal by a distance —
     * Open Library's subjects are a jumble ("Fiction", "History", "Histoire"),
     * and with only a couple of dozen books rated, an attribute threshold
     * built for six hundred films admits almost no authors at all.
     *
     * So the authors of individual books you thought were good count as seeds
     * in their own right, the same way one well-played album seeds music.
     */
    const seedAuthors = uniqueBy(
      [
        ...creators.map((c) => ({
          name: c.display || parseCreatorKey(c.key).name,
          support: c.support[0],
          key: c.key,
        })),
        ...seeds.map((w) => {
          const row = get('SELECT creators, metadata FROM works WHERE id = ?', w.id)
          const author = json(row?.creators, []).find((c) => c.role === 'Author' || !c.role)
          return author
            ? { name: author.name, support: w, key: `creator:Author|${String(author.name).toLowerCase()}`, metadata: json(row?.metadata, {}) }
            : null
        }).filter(Boolean),
      ],
      (a) => String(a.name).toLowerCase(),
    ).slice(0, Math.round(16 * breadth))

    for (const a of seedAuthors) {
      const meta = a.metadata
        || (a.support ? json(get('SELECT metadata FROM works WHERE id = ?', a.support.id)?.metadata, {}) : {})
      const authorKey = (meta.author_keys || [])[0]
      const byAuthor = authorKey
        ? await ol.byAuthorKey(authorKey, { limit: 20, type })
        : await ol.search(a.name, { limit: 14, type, author: a.name })
      push(byAuthor, 'creator', a.support, a.key, a.name, 'Author')
      if (type === 'audiobook') push(await itunes.search('audiobook', a.name, 8), 'creator', a.support, a.key, a.name, 'Author')
    }

    for (const g of genres.slice(0, 6)) {
      push(await ol.bySubject(g.display || g.key.replace('genre:', ''), { limit: 20, type }), 'genre', g.support[0], g.key, g.display)
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

function explain(candidate, profile, contributions, crowdSlot) {
  const bits = []
  const creatorVia = candidate.via.find((v) => v.via === 'creator' && v.seed)
  const similarVia = candidate.via.find((v) => v.via === 'similar' && v.seed)

  /*
   * The crowd's reason is the most convincing one there is, so it leads:
   * naming the films of yours that the agreement rests on makes it checkable
   * rather than something you have to take on faith.
   */
  if (crowdSlot && crowdSlot.score > 0) {
    const named = crowdSlot.from
      .slice(0, 2)
      .map((f) => get('SELECT title FROM works WHERE tmdb_id = ? LIMIT 1', String(f.tmdb_id))?.title)
      .filter(Boolean)
    if (named.length) {
      const others = crowdSlot.from.length - named.length
      bits.push(
        `Loved by people who rate ${named.join(' and ')}`
        + `${others > 0 ? ` and ${others} more of yours` : ''} as you do`,
      )
    }
  }

  if (similarVia) {
    bits.push(`Similar to ${similarVia.seed.title}${similarVia.seed.rating ? ` (${STAR(similarVia.seed.rating)})` : ''}`)
  }
  if (creatorVia) {
    const slot = creatorVia.attrKey ? profile.attrs.get(creatorVia.attrKey) : null
    const name = slot?.display || creatorVia.label
      || parseCreatorKey(creatorVia.attrKey || 'creator:Creator|').name
    const seed = creatorVia.seed
    bits.push(seed
      ? `More from ${name} — you gave ${seed.title} ${STAR(seed.rating) || 'a high rating'}`
      : `More from ${name}`)
  }
  for (const c of contributions.slice(0, 6)) {
    if (bits.length >= 2) break
    // A reason has to be a reason *for* the pick.
    if (c.contribution <= 0) continue
    if (c.key.startsWith('creator:') && creatorVia) continue
    // Decades are a weak signal: only mention one if nothing better turned up.
    if (c.key.startsWith('decade:') && contributions.some((x) => x !== c && x.contribution > 0 && !x.key.startsWith('decade:'))) continue
    const label = c.slot.display || c.key.split(':').pop()
    if (c.key.startsWith('genre:')) {
      const top = c.slot.support[0]
      bits.push(`You rate ${label} above your average${top ? ` (${top.title} ${STAR(top.rating)})` : ''}`)
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

const fpOf = (c) => c.fingerprint || `${c.type}|${normaliseTitle(c.title)}`

/** Score, explain and diversify. */
export function rank(candidates, profile, { limit = 12, shortlistOnly = false, crowd = null, shownBefore = null } = {}) {
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
      // Thin evidence can colour a recommendation but must not choose it.
      const support = slot.n >= MIN_SUPPORT ? 1 : 0.25
      const contribution = slot.score * slot.confidence * (KIND_WEIGHT[kind] ?? 0.4)
        * weight * crossMedia * support
      score += contribution
      contributions.push({ key, slot, contribution })
    }

    /*
     * What the crowd thinks. This is evidence rather than inference, so it
     * carries more weight than anything else here — but it only applies to
     * film and TV, and only to titles well enough known to appear in the
     * ratings data, so the rest of the scoring still has to stand on its own.
     */
    let crowdSlot = null
    if (crowd && c.tmdb_id) {
      crowdSlot = crowd.get(Number(c.tmdb_id)) || null
      if (crowdSlot) score += 1.25 * crowdSlot.score
    }

    /*
     * Provenance: being adjacent to something you loved is evidence, but one
     * such link is weak evidence — every film has a hundred neighbours. What
     * counts is *how many* of your favourites point at the same title, so the
     * bonus grows with the square root of that count and saturates.
     *
     * This used to be a flat 0.35 per link, which came to ~0.5 for a single
     * neighbour and buried the taste profile underneath it.
     */
    const mean = profile.meanByType[c.type] ?? profile.globalMean
    const links = c.via.filter((v) => (v.via === 'similar' || v.via === 'creator') && v.seed?.rating)
    if (links.length) {
      const lift = links.reduce((a, v) => a + Math.max(0, v.seed.rating - mean), 0) / links.length
      const breadth = Math.sqrt(links.length)
      score += 0.16 * breadth * (0.5 + lift)
    }

    /*
     * Quality prior. Deliberately firm: you rate 545 films at 3.6 on average,
     * so you watch well-regarded things, and a suggestion that is merely
     * adjacent to your taste but widely thought poor is a bad suggestion.
     */
    /*
     * Only a rating with some weight behind it counts. A 10/10 from a handful
     * of Open Library users was enough to float a Spanish dictionary to the
     * top of the book suggestions.
     */
    const backing = c.metadata?.vote_count ?? c.metadata?.ratings_count ?? 0
    const trusted = c.type === 'book' || c.type === 'audiobook' ? backing >= 8 : true
    if (c.external_rating != null && trusted) score += 0.55 * (c.external_rating / 10 - 0.66)
    const votes = c.metadata?.vote_count ?? 0
    if (votes) score += 0.08 * Math.min(2.2, Math.log10(1 + votes) - 2)
    if (c.popularity) score += 0.04 * Math.min(2, Math.log10(1 + c.popularity))
    if (!c.poster_url) score -= 0.08

    // Already offered recently: still eligible, but it has had its turn.
    if (shownBefore?.has(fpOf(c))) score -= 0.45

    contributions.sort((a, b) => b.contribution - a.contribution)
    scored.push({ ...c, score, contributions, crowd: crowdSlot, reasons: explain(c, profile, contributions, crowdSlot) })
  }

  scored.sort((a, b) => b.score - a.score)
  if (shortlistOnly) return scored

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
      /*
       * Subtracted, not multiplied.
       *
       * A score can be negative — anything shown on a recent refresh is pushed
       * below zero on purpose — and multiplying a negative number by a penalty
       * makes it *bigger*. So the rule meant to stop one author taking the
       * list was promoting them instead, which is how four Discworld novels
       * arrived in a row.
       */
      let penalty = 0
      for (const cr of c.creators || []) {
        const n = creatorCount.get(String(cr.name).toLowerCase()) || 0
        if (n) penalty += 0.45 * n
      }
      for (const g of (c.genres || []).slice(0, 3)) {
        const n = genreCount.get(String(g).toLowerCase()) || 0
        if (n >= 2) penalty += 0.05
      }
      const adjusted = c.score - penalty
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

/**
 * Fill in the credits and keywords a list-shaped result does not carry.
 *
 * Only the shortlist is fetched, a few at a time to stay polite, and anything
 * that fails keeps whatever it already had rather than dropping out.
 */
async function hydrateDetails(type, shortlist) {
  if ((type !== 'film' && type !== 'tv') || !tmdb.hasKey()) return shortlist

  const BATCH = 4
  const out = []
  for (let i = 0; i < shortlist.length; i += BATCH) {
    const slice = shortlist.slice(i, i + BATCH)
    const filled = await Promise.all(slice.map(async (c) => {
      if (!c.tmdb_id || c.metadata?.keywords?.length) return c
      const full = await tmdb.detail(type, c.tmdb_id).catch(() => null)
      if (!full) return c
      return {
        ...c,
        creators: full.creators?.length ? full.creators : c.creators,
        genres: full.genres?.length ? full.genres : c.genres,
        overview: c.overview || full.overview,
        runtime: c.runtime ?? full.runtime,
        language: c.language || full.language,
        imdb_id: c.imdb_id || full.imdb_id,
        metadata: { ...(c.metadata || {}), ...(full.metadata || {}) },
      }
    }))
    out.push(...filled)
  }
  return out
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
    /*
     * The cached list is only usable if it is at least as long as the one
     * being asked for. "Show more" asks for a bigger slice, and without this
     * check it was handed back the same short list it already had — which is
     * why the button appeared to do nothing at all.
     */
    const longEnough = (payload?.picks?.length ?? 0) >= limit
    if (payload && payload.fingerprint === fingerprint && age < CACHE_TTL_MS && longEnough) {
      return { ...payload, picks: payload.picks.slice(0, limit), cached: true }
    }
  }

  const profile = buildProfile()
  const ratedOfType = (profile.meanByType[type] != null)
  if (!ratedOfType && !profile.counts.rated) {
    return { type, fingerprint, picks: [], profileThin: true, cached: false }
  }

  /*
   * What the last couple of refreshes already offered.
   *
   * Pressing Refresh and seeing the same eight titles is not a refresh. The
   * engine is deterministic, so without this the same list comes back every
   * time — the fix is to push what you have already been shown down the order
   * rather than to add randomness, so a genuinely strong pick can still hold
   * its place while the rest of the list turns over.
   */
  const shownBefore = new Set()
  if (force) {
    for (const row of all('SELECT payload FROM rec_cache WHERE type = ? ORDER BY id DESC LIMIT 3', type)) {
      for (const fp of json(row.payload, {})?.picks?.map((p) => p.fingerprint) || []) shownBefore.add(fp)
    }
  }

  // Worked out once and used twice: to find candidates, and to score them.
  const crowd = crowdScores(type, profile)
  const raw = await candidatesForType(type, profile, { breadth, crowd })

  // Noise removal before anything else: an obscure badly-reviewed title is not
  // a suggestion whatever it sits next to.
  const candidates = raw.filter((c) => passesQuality(c, profile))

  /*
   * Two passes.
   *
   * Candidates arrive from search-shaped endpoints, which carry a title, a
   * year, a rating and genres — but no director and no keywords. Those are the
   * two sharpest things the profile knows about you, so scoring at this point
   * can only compare genres and decades, and the result was close to a coin
   * toss dressed up with reasons.
   *
   * So: score cheaply, take a shortlist, fetch the full record for those, and
   * score again properly. The detail responses are cached for a month, so this
   * is mostly free on the second run.
   */
  const shortlist = rank(candidates, profile, { shortlistOnly: true, crowd, shownBefore })
    .slice(0, Math.max(limit * 6, 70))
  const detailed = await hydrateDetails(type, shortlist)
  const picks = await hydrateArtwork(rank(detailed, profile, { limit, crowd, shownBefore }))

  const payload = {
    type,
    fingerprint,
    computed_at: new Date().toISOString(),
    candidateCount: candidates.length,
    usingTmdb: tmdb.hasKey(),
    usingCrowd: Boolean(crowd),
    crowdSize: crowd ? crowd.size : 0,
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

  // Keep the last few lists so "show me something else" has a memory.
  run(
    `DELETE FROM rec_cache
      WHERE type = ? AND id NOT IN (SELECT id FROM rec_cache WHERE type = ? ORDER BY id DESC LIMIT 2)`,
    type, type,
  )
  run(
    "INSERT INTO rec_cache (user_id, type, payload, computed_at) VALUES (?, ?, ?, datetime('now'))",
    systemUserId(), type, JSON.stringify(payload),
  )
  return { ...payload, cached: false }
}

export function blockRecommendation(fingerprint, reason) {
  run('INSERT OR REPLACE INTO rec_blocks (user_id, fingerprint, reason) VALUES (?, ?, ?)', systemUserId(), fingerprint, reason || null)
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
