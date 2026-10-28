/*
 * Board games.
 *
 * BoardGameGeek is the right source and everyone knows it, but their XML API
 * now answers 401 to everything and the site sits behind a bot challenge, so
 * it cannot be read from a server without credentials. Until a key exists,
 * this uses Wikidata — which is open, carries each game's BGG id, and so can
 * at least hand you a working link into the place the real data lives.
 *
 * Wikidata's coverage is honest but thin: most games have a title, an id and
 * little else, and the famous ones are often outranked by their expansions.
 * So results are fetched broadly and ranked here rather than trusted in the
 * order they arrive.
 *
 * When a BGG key arrives this becomes the fallback rather than the source:
 * see bggKey() below, which is the only switch that needs flipping.
 */
import { fetchText } from '../lib/fetchv4.js'
import { normaliseTitle, parseYear } from '../lib/util.js'
import { setting } from '../lib/settings.js'

const SPARQL = 'https://query.wikidata.org/sparql'
const UA = 'Shelved/0.1 (https://github.com/Dusky-Nembrotha/shelved; self-hosted personal media log)'

/** Set once BoardGameGeek issues one; until then everything runs on Wikidata. */
export function bggKey() {
  return setting('bgg_api_key') || null
}

export function hasKey() {
  return Boolean(bggKey())
}

const commons = (fileUrl) => {
  if (!fileUrl) return null
  const name = decodeURIComponent(String(fileUrl).split('/').pop() || '')
  return name ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=500` : null
}

const people = (joined, role) =>
  String(joined || '').split('|').filter(Boolean).slice(0, 2).map((name) => ({ role, name }))

function query(term) {
  const safe = String(term).toLowerCase().replace(/["\\]/g, ' ').trim()
  return `
SELECT ?game ?gameLabel ?bgg ?year ?minP ?maxP ?time ?img ?ages
  (GROUP_CONCAT(DISTINCT ?designerLabel; separator='|') AS ?designers)
  (GROUP_CONCAT(DISTINCT ?publisherLabel; separator='|') AS ?publishers)
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator='|') AS ?genres)
WHERE {
  ?game wdt:P31/wdt:P279* wd:Q131436 ;
        rdfs:label ?gameLabel .
  FILTER(LANG(?gameLabel) = 'en' && CONTAINS(LCASE(?gameLabel), "${safe}"))
  OPTIONAL { ?game wdt:P2339 ?bgg }
  OPTIONAL { ?game wdt:P571 ?inception . BIND(YEAR(?inception) AS ?year) }
  OPTIONAL { ?game wdt:P1872 ?minP }
  OPTIONAL { ?game wdt:P1873 ?maxP }
  OPTIONAL { ?game wdt:P2047 ?time }
  OPTIONAL { ?game wdt:P2899 ?ages }
  OPTIONAL { ?game wdt:P18 ?img }
  OPTIONAL { ?game wdt:P287 ?designer . ?designer rdfs:label ?designerLabel . FILTER(LANG(?designerLabel)='en') }
  OPTIONAL { ?game wdt:P123 ?publisher . ?publisher rdfs:label ?publisherLabel . FILTER(LANG(?publisherLabel)='en') }
  OPTIONAL { ?game wdt:P136 ?genre . ?genre rdfs:label ?genreLabel . FILTER(LANG(?genreLabel)='en') }
}
GROUP BY ?game ?gameLabel ?bgg ?year ?minP ?maxP ?time ?img ?ages
LIMIT 40`
}

function normalise(b) {
  const title = b.gameLabel?.value
  if (!title) return null
  const bgg = b.bgg?.value || null
  const players = [b.minP?.value, b.maxP?.value].filter(Boolean).map(Number)

  return {
    provider: 'wikidata',
    type: 'boardgame',
    title,
    year: b.year?.value ? Number(b.year.value) : parseYear(b.year?.value),
    creators: [
      ...people(b.designers?.value, 'Designer'),
      ...people(b.publishers?.value, 'Publisher'),
    ],
    genres: String(b.genres?.value || '').split('|').filter(Boolean).slice(0, 3),
    poster_url: commons(b.img?.value),
    // A game is measured in how long it takes to play.
    runtime: b.time?.value ? Math.round(Number(b.time.value)) : null,
    metadata: {
      bgg_id: bgg,
      // The point of the whole exercise: a way through to the real thing.
      bgg_url: bgg ? `https://boardgamegeek.com/boardgame/${bgg}` : null,
      wikidata_id: String(b.game?.value || '').split('/').pop() || null,
      min_players: players.length ? Math.min(...players) : null,
      max_players: players.length ? Math.max(...players) : null,
      min_age: b.ages?.value ? Number(b.ages.value) : null,
    },
  }
}

/*
 * Wikidata returns matches in no useful order, and an expansion with a long
 * name beats the game it expands. Rank by how much of the title the search
 * accounts for, then by whether anyone has bothered to catalogue it.
 */
function rank(items, term) {
  const want = normaliseTitle(term)
  return items
    .map((it) => {
      const title = normaliseTitle(it.title)
      let score = 0
      if (title === want) score += 100
      else if (title.startsWith(want)) score += 50
      else if (title.includes(want)) score += 20
      // Shorter titles are the base game; the long ones are its spin-offs.
      score -= Math.min(20, Math.max(0, title.length - want.length) * 0.4)
      if (it.metadata.bgg_id) score += 12
      if (it.poster_url) score += 6
      if (it.creators.length) score += 4
      if (it.year) score += 2
      if (/\bseries\b/i.test(it.title)) score -= 15
      return { it, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.it)
}

export async function search(term, limit = 12) {
  if (!term) return []
  try {
    const res = await fetchText(`${SPARQL}?format=json&query=${encodeURIComponent(query(term))}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
      timeout: 25000,
    })
    if (res.status !== 200) return []
    const rows = JSON.parse(res.text)?.results?.bindings || []
    const seen = new Set()
    const items = []
    for (const b of rows) {
      const it = normalise(b)
      if (!it) continue
      const key = normaliseTitle(it.title)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(it)
    }
    return rank(items, term).slice(0, limit)
  } catch {
    return []
  }
}
