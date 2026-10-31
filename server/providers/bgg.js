/*
 * BoardGameGeek, properly.
 *
 * Everything the board game shelf wanted and Wikidata could not give: the
 * designers, the mechanics, the player counts, the weight, the ranking, and
 * the box art — for every game rather than the few hundred notable enough to
 * have a Wikipedia article.
 *
 * Their API answers XML and refuses anonymous requests; the key goes in an
 * Authorization header. It is also rate-limited and slow to think, so the
 * per-host gap is generous and everything is cached for a day.
 */
import { fetchText } from '../lib/fetchv4.js'
import { setting } from '../lib/settings.js'
import { get, run } from '../lib/db.js'
import { parseYear } from '../lib/util.js'

const BASE = 'https://boardgamegeek.com/xmlapi2'
const UA = 'Shelved/0.1 (https://github.com/Dusky-Nembrotha/shelved; self-hosted personal media log)'

export function hasKey() {
  return Boolean(setting('bgg_api_key'))
}

/*
 * BGG's XML is regular enough to read without a parser: attributes are always
 * quoted, elements never nest inside the ones we want. A dependency to read
 * six shapes would be a dependency to keep.
 */
const attr = (xml, tag, name = 'value') => {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, 'i').exec(xml)
  return m ? decode(m[1]) : null
}
const text = (xml, tag) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return m ? decode(m[1].trim()) : null
}
const links = (xml, type) => [...new Set([
  ...xml.matchAll(new RegExp(`<link\\b[^>]*type="${type}"[^>]*value="([^"]*)"`, 'gi')),
].map((m) => decode(m[1])))]

function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
}

/*
 * Cached in the same table everything else uses, because BGG is slow — a cold
 * details call takes a second or two and the data changes by the week at most.
 */
async function ask(path, { ttlSeconds = 60 * 60 * 24 } = {}) {
  const key = setting('bgg_api_key')
  if (!key) return null
  const url = `${BASE}/${path}`
  const cached = get("SELECT body FROM http_cache WHERE key = ? AND expires_at > datetime('now')", `GET ${url}`)
  if (cached) return cached.body

  const res = await fetchText(url, {
    headers: { 'User-Agent': UA, Authorization: `Bearer ${key}`, Accept: 'text/xml' },
    timeout: 25000,
  })
  // 202 means "come back, I am building it"; the caller can simply try later.
  if (res.status !== 200 || !res.text) return null
  run(
    `INSERT INTO http_cache (key, body, fetched_at, expires_at)
     VALUES (?, ?, datetime('now'), datetime('now', ?))
     ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    `GET ${url}`, res.text, `+${Math.round(ttlSeconds)} seconds`,
  )
  return res.text
}

const items = (xml) => String(xml || '').split(/<item\b/).slice(1).map((chunk) => `<item ${chunk}`)

/** The hotness list: what BoardGameGeek is talking about this week. */
export async function hot(limit = 50) {
  const xml = await ask('hot?type=boardgame', { ttlSeconds: 60 * 60 * 6 })
  if (!xml) return []
  return items(xml).slice(0, limit).map((chunk) => {
    const id = /<item\s+id="(\d+)"/.exec(chunk)?.[1]
    const name = attr(chunk, 'name')
    if (!id || !name) return null
    return {
      bgg_id: id,
      title: name,
      year: Number(attr(chunk, 'yearpublished')) || null,
      rank: Number(/rank="(\d+)"/.exec(chunk)?.[1]) || null,
      thumbnail: attr(chunk, 'thumbnail'),
    }
  }).filter(Boolean)
}

/** Full records. Several ids in one request, which BGG does allow. */
export async function things(ids) {
  const wanted = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 20)
  if (!wanted.length) return new Map()
  const xml = await ask(`thing?id=${wanted.join(',')}&stats=1`)
  if (!xml) return new Map()

  const out = new Map()
  for (const chunk of items(xml)) {
    const id = /<item\b[^>]*\bid="(\d+)"/.exec(chunk)?.[1]
    // The primary name, not whichever translation came first.
    const title = /<name\b[^>]*type="primary"[^>]*value="([^"]*)"/i.exec(chunk)?.[1]
    if (!id || !title) continue

    const designers = links(chunk, 'boardgamedesigner').filter((n) => n !== '(Uncredited)')
    const min = Number(attr(chunk, 'minplayers')) || null
    const max = Number(attr(chunk, 'maxplayers')) || null
    const weight = Number(attr(chunk, 'averageweight')) || null

    out.set(id, {
      provider: 'bgg',
      type: 'boardgame',
      title: decode(title),
      year: Number(attr(chunk, 'yearpublished')) || parseYear(attr(chunk, 'yearpublished')),
      creators: [
        ...designers.slice(0, 2).map((name) => ({ role: 'Designer', name })),
        ...links(chunk, 'boardgameartist').slice(0, 1).map((name) => ({ role: 'Artist', name })),
        ...links(chunk, 'boardgamepublisher').slice(0, 1).map((name) => ({ role: 'Publisher', name })),
      ],
      // Categories are what a game is; mechanics are how it works. Both are
      // worth filtering by, and BGG is the only place that records either.
      genres: [...links(chunk, 'boardgamecategory'), ...links(chunk, 'boardgamemechanic')].slice(0, 8),
      overview: text(chunk, 'description'),
      poster_url: text(chunk, 'image') || attr(chunk, 'thumbnail'),
      runtime: Number(attr(chunk, 'playingtime')) || null,
      external_rating: Number(attr(chunk, 'average')) || null,
      metadata: {
        bgg_id: id,
        bgg_url: `https://boardgamegeek.com/boardgame/${id}`,
        min_players: min,
        max_players: max,
        min_age: Number(attr(chunk, 'minage')) || null,
        // How heavy it is, out of five — the thing people actually ask about.
        weight: weight ? Math.round(weight * 100) / 100 : null,
        bgg_rank: Number(/<rank\b[^>]*name="boardgame"[^>]*value="(\d+)"/i.exec(chunk)?.[1]) || null,
        vote_count: Number(attr(chunk, 'usersrated')) || null,
        mechanics: links(chunk, 'boardgamemechanic').slice(0, 6),
        categories: links(chunk, 'boardgamecategory').slice(0, 6),
      },
    })
  }
  return out
}

/** Search by name, best match first. */
export async function search(term, limit = 12) {
  if (!term) return []
  const xml = await ask(`search?query=${encodeURIComponent(term)}&type=boardgame`)
  if (!xml) return []

  const found = items(xml).map((chunk) => ({
    id: /<item\b[^>]*\bid="(\d+)"/.exec(chunk)?.[1],
    name: /<name\b[^>]*value="([^"]*)"/i.exec(chunk)?.[1],
    year: Number(attr(chunk, 'yearpublished')) || null,
  })).filter((x) => x.id && x.name)

  // Exact names first, then the oldest — which is the original rather than a
  // reissue or a themed spin-off of it.
  const want = String(term).toLowerCase()
  found.sort((a, b) => {
    const ax = decode(a.name).toLowerCase() === want ? 0 : 1
    const bx = decode(b.name).toLowerCase() === want ? 0 : 1
    return ax - bx || (a.year ?? 9999) - (b.year ?? 9999)
  })

  const full = await things(found.slice(0, limit).map((f) => f.id))
  return found.slice(0, limit).map((f) => full.get(f.id)).filter(Boolean)
}

/**
 * The hotness list, with everything known about each game on it.
 *
 * The chart itself names only the game and the year, so each one has to be
 * looked up — twenty at a time, which is all BGG will take, and cached for a
 * day. Cold that is a few seconds; after the first it is free.
 */
export async function hotDetailed(limit = 50) {
  const chart = await hot(limit)
  if (!chart.length) return []

  const full = new Map()
  for (let i = 0; i < chart.length; i += 20) {
    const batch = await things(chart.slice(i, i + 20).map((c) => c.bgg_id))
    for (const [id, item] of batch) full.set(id, item)
  }

  return chart.map((c) => {
    const item = full.get(c.bgg_id)
    if (!item) {
      // Still worth showing: the chart knew its name and its box.
      return {
        provider: 'bgg', type: 'boardgame', title: c.title, year: c.year,
        creators: [], genres: [], overview: null, poster_url: c.thumbnail,
        runtime: null, external_rating: null,
        metadata: { bgg_id: c.bgg_id, bgg_url: `https://boardgamegeek.com/boardgame/${c.bgg_id}`, rank: c.rank },
      }
    }
    return { ...item, metadata: { ...item.metadata, rank: c.rank } }
  })
}
