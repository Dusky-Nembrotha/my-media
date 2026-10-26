import { fetchJson } from '../lib/http.js'

/**
 * Keyless "more by the same person" candidate generation.
 * Wikidata knows every film a director made, every book an author wrote and
 * every album an artist released — which is the single strongest signal we can
 * get without an API key.
 */
const WD = 'https://www.wikidata.org/w/api.php'
const SPARQL = 'https://query.wikidata.org/sparql'

// instance-of class per media type
const CLASS = {
  film: 'wd:Q11424',
  tv: 'wd:Q5398426',
  book: 'wd:Q7725634',
  audiobook: 'wd:Q7725634',
  album: 'wd:Q482994',
  game: 'wd:Q7889',
}

// property linking the work to its creator, per role
const ROLE_PROP = {
  Director: 'P57',
  Creator: 'P170',
  Author: 'P50',
  Artist: 'P175',
  Developer: 'P178',
  Narrator: 'P50',
  Contributor: 'P50',
  Cast: 'P161',
}

const DESC_HINT = {
  film: /director|film|screenwriter|producer/i,
  tv: /director|producer|writer|showrunner|screenwriter/i,
  book: /writer|author|novelist|poet/i,
  audiobook: /writer|author|novelist/i,
  album: /musician|band|singer|rapper|group|composer|duo|artist/i,
  game: /developer|studio|company|designer/i,
}

export async function findEntity(name, type) {
  if (!name) return null
  try {
    const data = await fetchJson(
      `${WD}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&format=json&limit=5&origin=*`,
      { ttlSeconds: 60 * 60 * 24 * 90 },
    )
    const hits = data?.search || []
    const hint = DESC_HINT[type]
    const best = hits.find((h) => hint && hint.test(h.description || '')) || hits[0]
    return best ? { qid: best.id, label: best.label, description: best.description } : null
  } catch {
    return null
  }
}

async function sparql(query) {
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(query)}`
  return fetchJson(url, {
    ttlSeconds: 60 * 60 * 24 * 30,
    headers: { Accept: 'application/sparql-results+json' },
    retries: 1,
  })
}

/** Everything of `type` created by `qid`, newest first, with enwiki article names. */
export async function worksBy(qid, type, { role = 'Director', limit = 40 } = {}) {
  const cls = CLASS[type]
  const prop = ROLE_PROP[role] || 'P57'
  if (!cls || !qid) return []

  const query = `
    SELECT ?item ?itemLabel ?year ?imdb ?article ?runtime ?links WHERE {
      ?item wdt:${prop} wd:${qid} ; wdt:P31/wdt:P279* ${cls} ; wikibase:sitelinks ?links .
      OPTIONAL { ?item wdt:P577 ?date }
      OPTIONAL { ?item wdt:P345 ?imdb }
      OPTIONAL { ?item wdt:P2047 ?runtime }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
      BIND(YEAR(?date) AS ?year)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    } LIMIT ${limit * 4}`

  let data
  try {
    data = await sparql(query)
  } catch {
    return []
  }

  const thisYear = new Date().getFullYear()
  const byQid = new Map()
  for (const row of data?.results?.bindings || []) {
    const label = row.itemLabel?.value
    const id = row.item?.value?.split('/').pop()
    if (!label || !id || /^Q\d+$/.test(label)) continue   // unlabelled stub
    const year = row.year?.value ? Number(row.year.value) : null
    if (!year || year > thisYear) continue                 // unreleased / announced
    const runtime = row.runtime?.value ? Number(row.runtime.value) : null
    // Shorts and festival segments are not what anyone means by "more from X".
    if (type === 'film' && runtime != null && runtime < 50) continue
    const prev = byQid.get(id)
    if (prev) {
      if (year < prev.year) prev.year = year               // several release dates
      continue
    }
    byQid.set(id, {
      provider: 'wikidata',
      type,
      title: label,
      year,
      creators: [],
      genres: [],
      imdb_id: row.imdb?.value || null,
      runtime: runtime && runtime > 5 ? Math.round(runtime) : null,
      // Wikipedia language count is a decent stand-in for how well known it is.
      popularity: row.links?.value ? Number(row.links.value) : null,
      poster_url: null,
      metadata: {
        wikidata_qid: id,
        wikipedia_title: row.article?.value
          ? decodeURIComponent(row.article.value.split('/wiki/')[1] || '').replace(/_/g, ' ')
          : null,
      },
    })
  }
  return [...byQid.values()]
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || b.year - a.year)
    .slice(0, limit)
}
