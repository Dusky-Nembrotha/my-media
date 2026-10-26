import { fetchJson } from '../lib/http.js'
import { parseYear, splitPeople, uniqueBy } from '../lib/util.js'

/**
 * Keyless fallback for films (and games, and anything else). Wikipedia hosts
 * cover/poster art locally under fair use, which `pilicense=any` exposes, and
 * Wikidata supplies structured director/genre/runtime/ids.
 */
const WP = 'https://en.wikipedia.org/w/api.php'
const WD = 'https://www.wikidata.org/w/api.php'

const QUALIFIER = {
  film: 'film',
  tv: 'television series',
  book: 'novel book',
  game: 'video game',
  album: 'album',
  audiobook: 'book',
}

const PARENTHETICAL = /\s*\((?:\d{4}\s+)?(?:film|movie|TV series|TV programme|television series|novel|book|album|video game|miniseries|franchise|series)\)\s*$/i

function cleanTitle(title) {
  return String(title || '').replace(PARENTHETICAL, '').trim()
}

function cleanImage(url) {
  return url ? url.split('?')[0] : null
}

function normalise(page, type) {
  const title = cleanTitle(page.title)
  if (!title) return null
  const extract = page.extract || ''
  const year = parseYear((extract.match(/\b(?:is|was)\s+(?:an?\s+)?(?:upcoming\s+)?(\d{4})\b/) || [])[1])
    || parseYear((page.title.match(/\((\d{4})/) || [])[1])
  // "directed by X, written by Y and Z" — keep only the part before the next
  // credit clause, or Y and Z end up filed as directors.
  const CREDIT_BREAK = /\s*(?:,\s*)?\b(?:and\s+)?(?:written|co-written|from|based|produced|screenplay|starring|adapted|with)\b.*$/i
  const directors = ((extract.match(/directed by ([^.;(]+)/i) || [])[1] || '').replace(CREDIT_BREAK, '')
  const authors = ((extract.match(/(?:novel|book)\s+by\s+([^.;(]+)/i) || [])[1] || '').replace(CREDIT_BREAK, '')
  const creators = []
  const roleFor = type === 'film' || type === 'tv' ? 'Director' : 'Author'
  for (const name of splitPeople(directors || authors || '')) {
    // The lead sentence often runs on ("directed by X, written by Y") — keep
    // only the segments that are plainly names, and let Wikidata do the rest.
    if (/\b(by|from|based)\b/i.test(name) || !/^[A-Z\u00C0-\u024F]/.test(name)) continue
    creators.push({ role: roleFor, name })
  }

  return {
    provider: 'wikipedia',
    type,
    title,
    year: year || null,
    creators,
    genres: [],
    overview: extract ? extract.split('\n')[0].slice(0, 900) : null,
    poster_url: cleanImage(page.thumbnail?.source || page.original?.source),
    backdrop_url: cleanImage(page.original?.source || page.thumbnail?.source),
    popularity: page.index != null ? Math.max(1, 20 - page.index) : null,
    metadata: {
      wikipedia: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      wikidata: page.pageprops?.wikibase_item || null,
      wikipedia_title: page.title,
    },
  }
}

export async function search(type, term, limit = 8) {
  if (!term) return []
  const q = `${term} ${QUALIFIER[type] || ''}`.trim()
  const url = `${WP}?action=query&format=json&origin=*&generator=search`
    + `&gsrsearch=${encodeURIComponent(q)}&gsrlimit=${limit}&gsrnamespace=0`
    + `&prop=pageimages|extracts|pageprops&piprop=original|thumbnail&pithumbsize=640&pilicense=any`
    + `&exintro=1&explaintext=1&ppprop=wikibase_item`
  try {
    const data = await fetchJson(url, { ttlSeconds: 60 * 60 * 24 * 14 })
    const pages = Object.values(data?.query?.pages || {})
    return pages
      .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
      .map((p) => normalise(p, type))
      .filter((p) => p && p.poster_url !== undefined)
  } catch {
    return []
  }
}

/** Fill in structured facts from Wikidata: ids, runtime, genres, people. */
export async function enrichFromWikidata(seed) {
  const qid = seed?.metadata?.wikidata
  if (!qid) return seed
  try {
    const data = await fetchJson(
      `${WD}?action=wbgetentities&ids=${qid}&format=json&origin=*&props=claims`,
      { ttlSeconds: 60 * 60 * 24 * 60 },
    )
    const claims = data?.entities?.[qid]?.claims || {}
    const vals = (p) => (claims[p] || []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean)
    const ids = (p) => vals(p).map((v) => v.id).filter(Boolean)

    const refs = uniqueBy([
      ...ids('P136').map((id) => ({ id, kind: 'genre' })),   // genre
      ...ids('P57').map((id) => ({ id, kind: 'Director' })),  // director
      ...ids('P50').map((id) => ({ id, kind: 'Author' })),    // author
      ...ids('P175').map((id) => ({ id, kind: 'Artist' })),   // performer
      ...ids('P170').map((id) => ({ id, kind: 'Creator' })),  // creator
      ...ids('P178').map((id) => ({ id, kind: 'Developer' })),// developer
    ], (r) => r.id).slice(0, 25)

    let labels = {}
    if (refs.length) {
      const batch = await fetchJson(
        `${WD}?action=wbgetentities&ids=${refs.map((r) => r.id).join('|')}&format=json&origin=*&props=labels&languages=en`,
        { ttlSeconds: 60 * 60 * 24 * 90 },
      )
      for (const [id, ent] of Object.entries(batch?.entities || {})) {
        if (ent.labels?.en?.value) labels[id] = ent.labels.en.value
      }
    }

    const genres = refs.filter((r) => r.kind === 'genre').map((r) => labels[r.id])
      .filter(Boolean).map((g) => g.replace(/\s+(film|video game)$/i, ''))
    const people = refs.filter((r) => r.kind !== 'genre')
      .map((r) => (labels[r.id] ? { role: r.kind, name: labels[r.id] } : null)).filter(Boolean)

    const runtime = (claims.P2047 || [])[0]?.mainsnak?.datavalue?.value?.amount
    const pubDate = (claims.P577 || [])[0]?.mainsnak?.datavalue?.value?.time

    return {
      ...seed,
      year: seed.year || parseYear(pubDate),
      release_date: seed.release_date || (pubDate ? pubDate.replace(/^\+/, '').slice(0, 10) : null),
      runtime: seed.runtime || (runtime ? Math.round(Number(runtime)) : null),
      genres: uniqueBy([...(seed.genres || []), ...genres], (g) => String(g).toLowerCase()).slice(0, 10),
      creators: uniqueBy([...people, ...(seed.creators || [])], (c) => `${c.role}|${c.name.toLowerCase()}`).slice(0, 15),
      imdb_id: seed.imdb_id || vals('P345')[0] || null,
      tmdb_id: seed.tmdb_id || vals('P4947')[0] || vals('P4983')[0] || null,
      isbn: seed.isbn || vals('P212')[0] || vals('P957')[0] || null,
      metadata: { ...seed.metadata, wikidata_qid: qid, country: vals('P495').map((v) => v.id) },
    }
  } catch {
    return seed
  }
}

/**
 * One request, many posters. Used to put artwork on recommendation cards
 * sourced from Wikidata, where we only have article titles.
 */
export async function batchPageImages(titles) {
  const out = new Map()
  const list = [...new Set(titles.filter(Boolean))]
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25)
    const url = `${WP}?action=query&format=json&origin=*`
      + `&titles=${chunk.map((t) => encodeURIComponent(t)).join('|')}`
      + `&prop=pageimages|extracts|pageprops&piprop=original|thumbnail&pithumbsize=640&pilicense=any`
      + `&exintro=1&explaintext=1&exlimit=max&ppprop=wikibase_item&redirects=1`
    try {
      const data = await fetchJson(url, { ttlSeconds: 60 * 60 * 24 * 21 })
      const normalised = new Map()
      for (const n of data?.query?.normalized || []) normalised.set(n.to, n.from)
      for (const r of data?.query?.redirects || []) normalised.set(r.to, r.from)
      for (const page of Object.values(data?.query?.pages || {})) {
        const info = {
          poster_url: cleanImage(page.thumbnail?.source || page.original?.source),
          backdrop_url: cleanImage(page.original?.source || page.thumbnail?.source),
          overview: page.extract ? page.extract.split('\n')[0].slice(0, 900) : null,
        }
        out.set(page.title, info)
        const origin = normalised.get(page.title)
        if (origin) out.set(origin, info)
      }
    } catch { /* artwork is a nicety, never fatal */ }
  }
  return out
}
