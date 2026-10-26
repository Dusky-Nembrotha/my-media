import * as tmdb from './tmdb.js'
import * as itunes from './itunes.js'
import * as ol from './openlibrary.js'
import { cleanSubjects } from './openlibrary.js'
import * as mb from './musicbrainz.js'
import * as tvmaze from './tvmaze.js'
import * as wiki from './wikipedia.js'
import { normaliseTitle, uniqueBy } from '../lib/util.js'

export { tmdb, itunes, ol, mb, tvmaze, wiki }

const fp = (c) => `${c.type}|${normaliseTitle(c.title)}|${c.year || ''}`

/**
 * Which providers cover which media type. TMDB is optional (needs a key) but
 * takes precedence for film/TV when present; everything else is keyless.
 */
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
    default: return []
  }
}

export async function searchProviders(type, term, limit = 12) {
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
      jobs.push(itunes.search('album', term, limit))
      jobs.push(mb.searchAlbums(term, 8))
      break
    case 'track':
      jobs.push(itunes.search('track', term, limit))
      break
    case 'podcast':
      jobs.push(itunes.search('podcast', term, limit))
      break
    case 'game':
      jobs.push(wiki.search('game', term, limit))
      break
    default:
      return []
  }

  const settled = await Promise.allSettled(jobs)
  const results = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
  // Keep the richest copy of each title: providers are listed best-first.
  return uniqueBy(results.filter(Boolean), fp).slice(0, limit)
}

export async function searchAllTypes(term, types, perType = 5) {
  const list = types && types.length ? types : ['film', 'tv', 'book', 'audiobook', 'album']
  const settled = await Promise.allSettled(list.map((t) => searchProviders(t, term, perType)))
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
}

/**
 * Take a thin record (often just a title from a CSV) and fill in artwork,
 * genres, creators and ids from the best available provider.
 */
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
