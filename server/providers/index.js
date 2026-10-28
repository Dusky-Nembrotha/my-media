import * as tmdb from './tmdb.js'
import * as itunes from './itunes.js'
import * as ol from './openlibrary.js'
import { cleanSubjects } from './openlibrary.js'
import * as mb from './musicbrainz.js'
import * as tvmaze from './tvmaze.js'
import * as wiki from './wikipedia.js'
import * as wikidata from './wikidata.js'
import * as omdb from './omdb.js'
import * as gbooks from './googlebooks.js'
import * as imdbdata from './imdbdata.js'
import * as boardgame from './boardgame.js'
import * as steam from './steam.js'
import { normaliseTitle, uniqueBy } from '../lib/util.js'

export { tmdb, itunes, ol, mb, tvmaze, wiki, wikidata, omdb, gbooks, imdbdata, boardgame, steam }

const fp = (c) => `${c.type}|${normaliseTitle(c.title)}|${c.year || ''}`

/**
 * Which providers cover which media type. TMDB is optional (needs a key) but
 * takes precedence for film/TV when present; everything else is keyless.
 */
/**
 * What the public and the critics made of a film or show.
 *
 * IMDb's own score comes from the local copy of their published dataset:
 * free, instant, and with no daily allowance to spend. OMDb is still asked,
 * because Rotten Tomatoes and Metacritic are only available through it — but
 * when its thousand-a-day runs out, the IMDb number survives, which is the
 * one most people actually wanted.
 */
export async function screenRatings({ imdbId, title, year, type }) {
  const local = imdbdata.score({ imdbId, title, year, type })
  const found = await omdb.ratings({ imdbId, title, year, type }).catch(() => null)

  const out = (found?.ratings || []).filter((r) => !(local && r.source === 'IMDb'))
  if (local) {
    out.unshift({
      source: 'IMDb',
      score: local.rating,
      scale: 10,
      display: local.rating.toFixed(1),
      votes: local.votes,
      url: local.url,
    })
  }
  return { ratings: out, imdbId: found?.imdbId ?? null }
}

export function providersFor(type) {
  switch (type) {
    case 'film': return [tmdb.hasKey() && 'tmdb', 'wikipedia'].filter(Boolean)
    case 'tv': return [tmdb.hasKey() && 'tmdb', 'tvmaze', 'wikipedia'].filter(Boolean)
    case 'book': return ['openlibrary', 'itunes', 'wikipedia']
    case 'audiobook': return ['itunes', 'openlibrary']
    case 'album': return ['itunes', 'musicbrainz', 'wikipedia']
    case 'track': return ['itunes']
    case 'podcast': return ['itunes']
    case 'game': return ['wikipedia']
    case 'boardgame': return ['wikidata', 'wikipedia']
    default: return []
  }
}

/**
 * Run the provider calls in parallel but don't let the slowest decide how long
 * a search takes. The first provider for each type is the authoritative one;
 * the rest fill gaps. So once the primary has answered with a useful number of
 * results we stop waiting, and in any case we stop at the deadline.
 *
 * Nothing is lost by giving up early: each provider caches its own response, so
 * the next keystroke — or the next search for the same thing — includes it.
 */
function gather(jobs, { deadline = 1400, enough = 6 } = {}) {
  if (!jobs.length) return Promise.resolve([])
  return new Promise((resolve) => {
    // Results are kept per job and concatenated in job order, never in the
    // order they happen to arrive. The providers are listed best-first for a
    // reason, and the fastest one is not the most trustworthy one.
    const slots = jobs.map(() => [])
    let settled = 0
    let count = 0
    let primaryDone = false
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(slots.flat())
    }
    const timer = setTimeout(finish, deadline)

    jobs.forEach((job, i) => {
      Promise.resolve(job)
        .then((v) => { if (Array.isArray(v)) { slots[i] = v; count += v.length } })
        .catch(() => {})
        .finally(() => {
          if (i === 0) primaryDone = true
          if (++settled === jobs.length) return finish()
          if (primaryDone && count >= enough) finish()
        })
    })
  })
}

/*
 * Books that exist only because another book does: summaries, study guides,
 * "trivia", reading-group questions, reviews of the real thing. The Apple
 * Books store is full of them and they crowd out the actual novel, because
 * their titles contain it word for word.
 */
const DERIVATIVE = new RegExp([
  '\\bsummary\\b', '\\bsynopsis of\\b', '^summary:',
  '\\bexploring\\b.*\\b(?:by|novel|book)\\b',
  'study guide', 'studyguide', 'trivia[- ]on[- ]books', '\\btrivia\\b',
  'conversation starters', 'quicklet', 'key takeaways', '\\bworkbook\\b',
  'reading group guide', 'book club questions', '\\bsparknotes\\b', '\\bcliffs ?notes\\b',
  '\\b(?:book|movie|film) review\\b', 'after reading\\b', 'personal reflections',
  '\\ban analysis of\\b', '\\ba guide to\\b', '\\bunofficial\\b',
  // Study aids sold under the novel's own name. "Notes" alone is far too
  // broad — "Notes from Walnut Tree Farm" is a real book — so each series is
  // named outright.
  'monarch notes', 'york notes', 'coles notes', 'critical commentary',
  'close[- ]up guide', "reader'?s guide", "barron'?s", 'insight text guide',
  'a critical (?:study|analysis|edition)',
].join('|'), 'i')

/** Box sets and omnibuses: real, but not what someone searching a title means. */
const COLLECTION = new RegExp([
  '\\bbox(?:ed)? set\\b', '\\bomnibus\\b', '\\bcomplete (?:series|collection|novels|works)\\b',
  '\\bcollection\\b', '\\bbooks? \\d+\\s*[-–]\\s*\\d+', '\\b\\d+\\s*[-–]\\s*\\d+\\s+(?:box|collection|set)',
  '\\bcompanion\\b', '\\bgraphic novel\\b', '#\\d+\\s*$',
  '\\b(?:tri|du|quad)logy\\b', '\\bslipcase\\b',
  // Trade packs a bookshop would order, not something anyone reads.
  '\\bbacklist\\b', '\\b\\d+[- ]copy\\b', '\\bppk\\b', '\\bmixed p(?:ac)?k\\b', '\\bdisplay pack\\b',
].join('|'), 'i')

export function bookNoise(title) {
  const t = String(title || '')
  if (DERIVATIVE.test(t)) return 'derivative'
  if (COLLECTION.test(t)) return 'collection'
  return null
}

export async function searchProviders(type, term, limit = 12, { field } = {}) {
  if (!term || !term.trim()) return []
  const jobs = []

  switch (type) {
    case 'film':
      if (tmdb.hasKey()) jobs.push(tmdb.search('film', term, limit))
      jobs.push(wiki.search('film', term, 6))
      break
    case 'tv':
      if (tmdb.hasKey()) jobs.push(tmdb.search('tv', term, limit))
      jobs.push(tvmaze.search(term, limit))
      jobs.push(wiki.search('tv', term, 4))
      break
    case 'book':
      jobs.push(ol.search(term, { limit, type: 'book' }))
      jobs.push(itunes.search('book', term, 6))
      break
    case 'audiobook':
      jobs.push(itunes.search('audiobook', term, limit))
      jobs.push(ol.search(term, { limit: 6, type: 'audiobook' }))
      break
    case 'album':
      jobs.push(itunes.search('album', term, limit, { field }))
      // MusicBrainz takes a fielded query of its own.
      jobs.push(mb.searchAlbums(field === 'artist' ? `artist:"${term}"` : term, 8))
      break
    case 'track':
      jobs.push(itunes.search('track', term, limit, { field }))
      break
    case 'podcast':
      jobs.push(itunes.search('podcast', term, limit, { field }))
      break
    case 'boardgame':
      jobs.push(boardgame.search(term, limit))
      break
    case 'game':
      jobs.push(wiki.search('game', term, limit))
      break
    default:
      return []
  }

  /*
   * The deadline only bites when the authoritative provider is slow — as soon
   * as it answers with enough results we stop waiting anyway. So it can be
   * generous: cutting Open Library off at 1.4s left book searches showing
   * nothing but the Apple store's audiobook listings.
   */
  const results = await gather(jobs, { deadline: 2600, enough: Math.min(6, limit) })
  let list = uniqueBy(results.filter(Boolean), fp)

  /*
   * Asking for a title means the title has to match. Searching "Gold" for an
   * album otherwise returns everything by Adekunle Gold as readily as the
   * record called Gold.
   */
  if (field === 'title') {
    const want = normaliseTitle(term)
    const matching = list.filter((h) => normaliseTitle(h.title).includes(want))
    if (matching.length) list = matching
  }

  if (type === 'book' || type === 'audiobook') {
    /*
     * Summaries and study guides are dropped outright — nobody searching a
     * novel wants one. Box sets and companions are real things you might own,
     * so they are kept but pushed below the books themselves.
     */
    const graded = list.map((hit) => ({ hit, noise: bookNoise(hit.title) }))
    const keep = graded.filter((g) => g.noise !== 'derivative')
    list = [
      ...keep.filter((g) => !g.noise).map((g) => g.hit),
      ...keep.filter((g) => g.noise === 'collection').map((g) => g.hit),
    ]
  }

  return list.slice(0, limit)
}

export async function searchAllTypes(term, types, perType = 5) {
  const list = types && types.length ? types : ['film', 'tv', 'book', 'audiobook', 'album']
  return gather(list.map((t) => searchProviders(t, term, perType)), { deadline: 3000, enough: 10 })
}

/**
 * Take a thin record (often just a title from a CSV) and fill in artwork,
 * genres, creators and ids from the best available provider.
 */
/**
 * Film or TV? Netflix's export says only the title, so a show whose rows carry
 * no "Season N" marker arrives looking like a film. Ask both sides and let the
 * better title match decide.
 *
 * Only a clear winner counts: an exact title match on one side and not the
 * other. Anything less and the original guess stands, because a wrong flip is
 * worse than a wrong-but-expected default.
 */
export async function resolveScreenType(title, year, { showCandidate = null } = {}) {
  if (!title) return null
  const want = normaliseTitle(title)

  const rank = (hits, target = want) => {
    let best = 0
    for (const h of hits || []) {
      const t = normaliseTitle(h.title)
      let n = t === target ? 3 : t.startsWith(target) ? 1 : 0
      if (!n) continue
      // A year that matches is corroboration; one that clashes is a caution.
      if (n === 3 && year && h.year) n += Math.abs(h.year - year) <= 1 ? 1 : -0.5
      best = Math.max(best, n)
    }
    return best
  }

  const [films, shows, candidateShows] = await Promise.all([
    searchProviders('film', title, 6).catch(() => []),
    searchProviders('tv', title, 6).catch(() => []),
    showCandidate ? searchProviders('tv', showCandidate, 6).catch(() => []) : Promise.resolve([]),
  ])

  const filmScore = rank(films)
  const tvScore = rank(shows)
  if (tvScore >= 3 && tvScore > filmScore) return { type: 'tv', title }
  if (filmScore >= 3 && filmScore > tvScore) return { type: 'film', title }

  /*
   * Nothing matched the full title. If the part before the colon is itself a
   * show — "aka Charlie Sheen: Part One" — then this is an episode of it, and
   * the entry belongs under the show's name rather than the episode's.
   */
  if (showCandidate && filmScore < 3) {
    const want2 = normaliseTitle(showCandidate)
    if (rank(candidateShows, want2) >= 3) return { type: 'tv', title: showCandidate }
  }
  return null
}

export async function enrich(seed) {
  const { type } = seed
  const term = [seed.title, seed.creators?.[0]?.name].filter(Boolean).join(' ')

  if (type === 'film' || type === 'tv') {
    if (tmdb.hasKey()) {
      if (seed.tmdb_id) {
        const hit = await tmdb.detail(type, seed.tmdb_id)
        if (hit) return hit
      }
      if (seed.imdb_id) {
        const hit = await tmdb.findByExternalId(seed.imdb_id, type)
        if (hit) return hit
      }
      const hits = await tmdb.search(type, seed.title, 8)
      const best = chooseBest(hits, seed)
      if (best) return (await tmdb.detail(type, best.tmdb_id)) || best
    }
    if (type === 'tv') {
      if (seed.imdb_id) {
        const hit = await tvmaze.byImdb(seed.imdb_id)
        if (hit) return hit
      }
      const best = chooseBest(await tvmaze.search(seed.title, 8), seed)
      if (best) return best
    }
    const wikiHit = chooseBest(await wiki.search(type, seed.title, 6), seed)
    return wikiHit ? await wiki.enrichFromWikidata(wikiHit) : null
  }

  if (type === 'book' || type === 'audiobook') {
    /*
     * Google Books first, where a key is set.
     *
     * Open Library describes a work — every edition in every language at once
     * — so its title, author and description belong to whichever edition
     * sorted first. Google describes one published volume, which is why it
     * does not hand back Turkish covers for English novels or credit a
     * foreword writer as the author. Its cover art is poorer though, so Open
     * Library is still asked afterwards to fill the gaps.
     */
    if (gbooks.hasKey()) {
      const byIsbn = seed.isbn ? await gbooks.byIsbn(seed.isbn, type) : null
      const author = (seed.creators || []).find((c) => c.role === 'Author' || !c.role)?.name
      const best = byIsbn && chooseBest([byIsbn], seed)
        ? byIsbn
        : chooseBest(await gbooks.search(seed.title, { limit: 8, author, type }), seed)
      if (best) return await withBookCover(best, seed)
    }

    if (seed.isbn) {
      // Open Library's ISBN index is occasionally wrong, so an ISBN hit still
      // has to look like the book we asked for.
      const hit = await ol.byIsbn(seed.isbn, type)
      if (hit && chooseBest([hit], seed)) return await withBookDetail(hit)
    }
    if (type === 'audiobook') {
      const best = chooseBest(await itunes.search('audiobook', term, 8), seed)
      if (best) return best
    }
    const author = (seed.creators || []).find((c) => c.role === 'Author' || !c.role)?.name
    const best = chooseBest(
      await ol.search(seed.title, { limit: 8, type, author: author || undefined }),
      seed,
    )
    if (best) return await withBookDetail(best)
    if (type === 'book') {
      const alt = chooseBest(await itunes.search('book', term, 6), seed)
      if (alt) return alt
    }
    return null
  }

  if (type === 'album') {
    const best = chooseBest(await itunes.search('album', term, 8), seed)
    if (best) return best
    return chooseBest(await mb.searchAlbums(term, 6), seed)
  }

  if (type === 'track' || type === 'podcast') {
    return chooseBest(await itunes.search(type, term, 8), seed)
  }

  if (type === 'game') {
    const best = chooseBest(await wiki.search('game', seed.title, 6), seed)
    return best ? await wiki.enrichFromWikidata(best) : null
  }

  return null
}

/**
 * Google's cover art is thin — often a small scan or nothing at all — while
 * Open Library has thousands of them. So a Google match keeps its own title,
 * author and description, and borrows a cover if it lacks a decent one.
 */
async function withBookCover(hit, seed) {
  if (hit.poster_url && !/zoom=5|no_cover/i.test(hit.poster_url)) return hit
  const author = hit.creators?.[0]?.name || (seed.creators || [])[0]?.name
  const covers = await ol.editionCovers(hit.title, author, 4).catch(() => [])
  return covers[0]?.url ? { ...hit, poster_url: covers[0].url } : hit
}

async function withBookDetail(hit) {
  if (hit.overview || !hit.olid) return hit
  const detail = await ol.workDetail(hit.olid)
  if (!detail) return hit
  return {
    ...hit,
    overview: detail.overview || hit.overview,
    genres: uniqueBy([...(hit.genres || []), ...cleanSubjects(detail.subjects).slice(0, 10)], (g) => String(g).toLowerCase()),
  }
}

/** Title/year/creator similarity so a CSV row lands on the right title. */
export function chooseBest(candidates, seed) {
  if (!candidates || !candidates.length) return null
  const wantTitle = normaliseTitle(seed.title)
  const wantYear = seed.year ? Number(seed.year) : null
  const wantPerson = (seed.creators || []).map((c) => String(c.name).toLowerCase())

  let best = null
  let bestScore = -Infinity
  for (const c of candidates) {
    let score = 0
    const t = normaliseTitle(c.title)
    if (t === wantTitle) score += 10
    else if (t.startsWith(wantTitle) || wantTitle.startsWith(t)) score += 6
    else if (t.includes(wantTitle) || wantTitle.includes(t)) score += 3
    else continue   // different title: no amount of author or year agreement saves it

    if (wantYear && c.year) {
      const diff = Math.abs(c.year - wantYear)
      score += diff === 0 ? 5 : diff === 1 ? 3 : diff <= 3 ? 0 : -4
    }
    if (wantPerson.length && c.creators?.length) {
      const names = c.creators.map((p) => String(p.name).toLowerCase())
      if (wantPerson.some((w) => names.some((n) => n.includes(w) || w.includes(n)))) score += 4
    }
    if (c.poster_url) score += 1
    if (c.provider === 'tmdb') score += 1.5
    if (c.popularity) score += Math.min(1.5, Math.log10(1 + c.popularity) / 2)

    if (score > bestScore) { bestScore = score; best = c }
  }
  return bestScore > 0 ? best : null
}
