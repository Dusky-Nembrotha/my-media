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
import { fetchJson } from '../lib/http.js'
import { normaliseTitle, parseYear } from '../lib/util.js'
import { setting } from '../lib/settings.js'

const SPARQL = 'https://query.wikidata.org/sparql'
const DBPEDIA = 'https://dbpedia.org/sparql'
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

const esc = (v) => String(v).replace(/["\\]/g, ' ').trim()

function query(filter) {
  return `
SELECT ?game ?gameLabel ?bgg ?year ?minP ?maxP ?time ?img ?ages ?article
  (GROUP_CONCAT(DISTINCT ?designerLabel; separator='|') AS ?designers)
  (GROUP_CONCAT(DISTINCT ?publisherLabel; separator='|') AS ?publishers)
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator='|') AS ?genres)
WHERE {
  ?game wdt:P31/wdt:P279* wd:Q131436 ;
        rdfs:label ?gameLabel .
  FILTER(LANG(?gameLabel) = 'en')
  ${filter}
  OPTIONAL { ?game wdt:P2339 ?bgg }
  OPTIONAL {
    ?article schema:about ?game ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
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
GROUP BY ?game ?gameLabel ?bgg ?year ?minP ?maxP ?time ?img ?ages ?article
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
      wikipedia: b.article?.value || null,
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

/** Run any of the shaped queries and turn the rows into candidates. */
async function run(filter, { limit, term }) {
  try {
    const res = await fetchText(`${SPARQL}?format=json&query=${encodeURIComponent(query(filter))}`, {
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
    const ordered = term ? rank(items, term) : items
    return enrichFromWikipedia(ordered.slice(0, limit))
  } catch {
    return []
  }
}

export async function search(term, limit = 12) {
  if (!term) return []
  return run(`FILTER(CONTAINS(LCASE(?gameLabel), "${esc(String(term).toLowerCase())}"))`, { limit, term })
}

/**
 * Everything else by someone whose game you rated highly.
 *
 * The strongest thing anyone can say about a board game is who designed it:
 * a Knizia and a Feld feel nothing like each other, and people who like one
 * tend to like the rest of theirs. Publishers are deliberately not matched —
 * sharing a publisher says almost nothing about how a game plays.
 */
export async function byDesigner(name, limit = 12) {
  if (!name) return []
  const want = esc(String(name).toLowerCase())
  /*
   * Against DBpedia, not Wikidata: the designer is the whole reason this
   * lookup exists and Wikidata mostly does not record one — P287 is empty for
   * Catan, which is Klaus Teuber's most famous game. The infobox has it.
   */
  const q = `
SELECT DISTINCT ?game (SAMPLE(?lab) AS ?label)
       (GROUP_CONCAT(DISTINCT ?des; separator='|') AS ?designers)
       (SAMPLE(?pt) AS ?time) (SAMPLE(?th) AS ?thumb) (SAMPLE(?ab) AS ?abstract)
WHERE {
  ?game dbp:designer ?d ; rdfs:label ?lab .
  FILTER(LANG(?lab) = 'en')
  FILTER(CONTAINS(LCASE(STR(?d)), "${want.replace(/ /g, '_')}") || CONTAINS(LCASE(STR(?d)), "${want}"))
  BIND(REPLACE(REPLACE(STR(?d), '^.*/', ''), '_', ' ') AS ?des)
  OPTIONAL { ?game dbp:playingTime ?pt }
  OPTIONAL { ?game dbo:thumbnail ?th }
  OPTIONAL { ?game dbo:abstract ?ab FILTER(LANG(?ab) = 'en') }
}
GROUP BY ?game
LIMIT ${Math.max(limit, 20)}`

  try {
    const res = await fetchText(
      `${DBPEDIA}?format=application%2Fsparql-results%2Bjson&query=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, timeout: 25000 },
    )
    if (res.status !== 200) return []
    const rows = JSON.parse(res.text)?.results?.bindings || []

    const items = rows.map((b) => {
      const article = decodeURIComponent(String(b.game?.value || '').split('/').pop() || '')
      const title = String(b.label?.value || '').replace(/\s*\((?:board|card|video)\s*game\)\s*$/i, '').trim()
      if (!title) return null
      const seconds = Math.abs(Number(b.time?.value))
      return {
        provider: 'dbpedia',
        type: 'boardgame',
        title,
        year: null,
        creators: clean(b.designers?.value).slice(0, 2).map((n) => ({ role: 'Designer', name: n })),
        genres: [],
        overview: b.abstract?.value || null,
        poster_url: b.thumb?.value || null,
        runtime: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : null,
        metadata: {
          bgg_id: null,
          bgg_url: null,
          wikipedia: article ? `https://en.wikipedia.org/wiki/${article}` : null,
        },
      }
    }).filter(Boolean)

    const picked = items.slice(0, limit)
    const art = await boxArt(picked.map((it) => articleOf(it.metadata.wikipedia)).filter(Boolean))
    return withBggIds(picked.map((it) => ({
      ...it,
      poster_url: art.get(articleOf(it.metadata.wikipedia)) || it.poster_url || null,
    })))
  } catch {
    return []
  }
}

/*
 * The BoardGameGeek id for a set of articles, in one query.
 *
 * DBpedia has the designers and Wikidata has the ids, and a game is no use
 * here without a way through to BGG — so whichever source found the game, the
 * other is asked for the missing half.
 */
async function withBggIds(items) {
  const articles = items
    .map((it) => decodeURIComponent(String(it.metadata.wikipedia || '').split('/wiki/').pop() || ''))
    .filter(Boolean)
  if (!articles.length) return items

  const values = articles
    .map((a) => `<https://en.wikipedia.org/wiki/${encodeURI(a)}>`)
    .join(' ')
  const q = `
SELECT ?article ?bgg WHERE {
  VALUES ?article { ${values} }
  ?article schema:about ?game .
  ?game wdt:P2339 ?bgg .
}`
  try {
    const res = await fetchText(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
      timeout: 20000,
    })
    if (res.status !== 200) return items
    const byArticle = new Map()
    for (const b of JSON.parse(res.text)?.results?.bindings || []) {
      byArticle.set(decodeURIComponent(String(b.article.value).split('/wiki/').pop() || ''), b.bgg.value)
    }
    return items.map((it) => {
      const key = decodeURIComponent(String(it.metadata.wikipedia || '').split('/wiki/').pop() || '')
      const bgg = byArticle.get(key)
      return bgg
        ? { ...it, metadata: { ...it.metadata, bgg_id: bgg, bgg_url: `https://boardgamegeek.com/boardgame/${bgg}` } }
        : it
    })
  } catch {
    return items
  }
}

/** Games filed under a genre you return to — the weaker of the two signals. */
export async function byGenre(genre, limit = 12) {
  if (!genre) return []
  /*
   * Either kind of statement. Wikidata files "German-style board game" as a
   * class these games are instances of, not as a genre they have — so asking
   * only about genre found nothing at all, including for the games the genre
   * had just been read off.
   */
  return run(`
  { ?game wdt:P136 ?g } UNION { ?game wdt:P31 ?g }
  ?g rdfs:label ?gLabel .
  FILTER(LANG(?gLabel) = 'en' && LCASE(?gLabel) = "${esc(String(genre).toLowerCase())}")`, { limit })
}

/*
 * What Wikipedia's infobox knows, which is a great deal more than Wikidata.
 *
 * Wikidata holds the BoardGameGeek id and almost nothing else — no designer
 * for Carcassonne, no year for Pandemic. DBpedia extracts the same articles'
 * infoboxes, where all of that is filled in, and it takes a list of subjects
 * in one query, so enriching a whole page of results costs one request rather
 * than one each.
 */
function dbpediaQuery(articles) {
  const values = articles
    .map((a) => `<http://dbpedia.org/resource/${a.replace(/ /g, '_')}>`)
    .join(' ')
  return `
SELECT ?game (GROUP_CONCAT(DISTINCT ?des; separator='|') AS ?designers)
       (GROUP_CONCAT(DISTINCT ?pub; separator='|') AS ?publishers)
       (GROUP_CONCAT(DISTINCT ?gen; separator='|') AS ?genres)
       (SAMPLE(?pt) AS ?time) (SAMPLE(?y1) AS ?years) (SAMPLE(?y2) AS ?dated)
       (SAMPLE(?th) AS ?thumb)
       (SAMPLE(?ab) AS ?abstract)
WHERE {
  VALUES ?game { ${values} }
  OPTIONAL { ?game dbp:designer ?d  BIND(REPLACE(REPLACE(STR(?d),  '^.*/',''), '_', ' ') AS ?des) }
  OPTIONAL { ?game dbp:publisher ?p BIND(REPLACE(REPLACE(STR(?p),  '^.*/',''), '_', ' ') AS ?pub) }
  OPTIONAL { ?game dbp:genre ?g     BIND(REPLACE(REPLACE(STR(?g),  '^.*/',''), '_', ' ') AS ?gen) }
  OPTIONAL { ?game dbp:playingTime ?pt }
  # Separate variables: binding one name across several OPTIONALs turns the
  # later ones into a filter on the first, which is why every year was blank.
  OPTIONAL { ?game dbp:years ?y1 }
  OPTIONAL { ?game dbp:date ?y2 }
  OPTIONAL { ?game dbo:thumbnail ?th }
  OPTIONAL { ?game dbo:abstract ?ab FILTER(LANG(?ab) = 'en') }
}
GROUP BY ?game`
}

/*
 * The box, from the article's own infobox.
 *
 * Neither of the obvious sources gives you a board game's cover. Wikidata's
 * P18 is a photograph of the game being played — Pandemic was a snapshot of
 * a convention hall in Essen in 2008, Ticket to Ride somebody's table — and
 * DBpedia's thumbnail points at Commons, where box art cannot live: it is
 * non-free, so it is uploaded to Wikipedia itself under fair use and the
 * Commons address 404s.
 *
 * MediaWiki's own pageimages knows where the file really is, takes fifty
 * titles at a time, and pilicense=any is what admits the fair-use uploads.
 */
async function boxArt(articles) {
  const titles = [...new Set(articles)].slice(0, 50)
  if (!titles.length) return new Map()
  try {
    const j = await fetchJson(
      'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages'
      + `&piprop=thumbnail&pithumbsize=600&pilicense=any&titles=${encodeURIComponent(titles.join('|'))}`,
      { ttlSeconds: 60 * 60 * 24 * 7 },
    )
    const out = new Map()
    for (const page of Object.values(j?.query?.pages || {})) {
      if (page?.title && page?.thumbnail?.source) out.set(page.title, page.thumbnail.source)
    }
    return out
  } catch {
    return new Map()
  }
}

const articleOf = (url) => decodeURIComponent(String(url || '').split('/wiki/').pop() || '').replace(/_/g, ' ')

/** A DBpedia value that is a bare word rather than a sentence fragment. */
const clean = (v) => {
  const out = String(v || '').split('|').map((x) => x.trim()).filter(Boolean)
    .filter((x) => x.length > 1 && x.length < 48 && !/^\d+$/.test(x))
  return [...new Set(out)]
}

async function enrichFromWikipedia(items) {
  const articles = items
    .map((it) => it.metadata.wikipedia)
    .filter(Boolean)
    .map((url) => decodeURIComponent(String(url).split('/wiki/').pop() || ''))
    .filter(Boolean)
  if (!articles.length) return items

  let rows = []
  try {
    const res = await fetchText(
      `${DBPEDIA}?format=application%2Fsparql-results%2Bjson&query=${encodeURIComponent(dbpediaQuery(articles.slice(0, 20)))}`,
      { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, timeout: 25000 },
    )
    if (res.status !== 200) return items
    rows = JSON.parse(res.text)?.results?.bindings || []
  } catch {
    return items
  }

  const byArticle = new Map()
  for (const b of rows) {
    const key = decodeURIComponent(String(b.game?.value || '').split('/').pop() || '')
    if (key) byArticle.set(key, b)
  }

  const art = await boxArt(items.map((it) => articleOf(it.metadata.wikipedia)).filter(Boolean))

  return items.map((it) => {
    const key = decodeURIComponent(String(it.metadata.wikipedia || '').split('/wiki/').pop() || '')
    const b = byArticle.get(key)
    if (!b) return it

    const designers = clean(b.designers?.value).slice(0, 2).map((name) => ({ role: 'Designer', name }))
    const publishers = clean(b.publishers?.value).slice(0, 1).map((name) => ({ role: 'Publisher', name }))
    // Infobox playing time arrives in seconds, and sometimes negative.
    const seconds = Math.abs(Number(b.time?.value))
    const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : null

    /*
     * Merged, not substituted. Wikidata tends to know a publisher and nothing
     * else, which is enough to look like an answer and so suppress the real
     * one — Wingspan was being credited to a Russian publisher rather than to
     * Elizabeth Hargrave. Whoever designed it goes first; it is their game.
     */
    const merged = []
    for (const c of [...designers, ...it.creators, ...publishers]) {
      if (!c?.name) continue
      if (merged.some((m) => m.name.toLowerCase() === c.name.toLowerCase())) continue
      merged.push(c)
    }

    return {
      ...it,
      // Wikidata's answer wins where it has one; this fills the silence.
      year: it.year || parseYear(b.years?.value) || parseYear(b.dated?.value) || null,
      creators: merged.slice(0, 3),
      genres: it.genres.length ? it.genres : clean(b.genres?.value).slice(0, 3),
      overview: b.abstract?.value || null,
      // The infobox first: Wikidata's picture is usually of a table, not a box.
      poster_url: art.get(articleOf(it.metadata.wikipedia)) || it.poster_url || null,
      runtime: it.runtime || minutes,
    }
  })
}
