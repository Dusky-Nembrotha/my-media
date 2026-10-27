import { get, run } from './db.js'
import { fetchText } from './fetchv4.js'

/*
 * Wikimedia's user-agent policy asks for a way to get in touch, and their
 * SPARQL endpoint refuses anything that does not carry one — which is why
 * series lookups were coming back as 429 regardless of how slowly we asked.
 */
const UA = 'Shelved/0.1 (https://github.com/Dusky-Nembrotha/shelved; self-hosted personal media log)'
const queues = new Map()

/** Per-host politeness: serialise requests and space them out. */
function throttle(host, minGapMs) {
  const prev = queues.get(host) || Promise.resolve()
  let release
  const next = new Promise((r) => (release = r))
  queues.set(host, prev.then(() => next))
  return prev.then(() => ({
    done: () => setTimeout(release, minGapMs),
  }))
}

const HOST_GAP = {
  'musicbrainz.org': 1100,      // documented 1 req/sec
  'en.wikipedia.org': 600,      // bulk enrichment gets throttled below this
  'www.wikidata.org': 600,
  'query.wikidata.org': 1500,   // SPARQL is expensive for them
  'openlibrary.org': 250,
  'itunes.apple.com': 300,
  'api.themoviedb.org': 60,
}

export async function fetchJson(url, { ttlSeconds = 60 * 60 * 24 * 7, headers = {}, retries = 3 } = {}) {
  const key = 'GET ' + url
  const cached = get("SELECT body FROM http_cache WHERE key = ? AND expires_at > datetime('now')", key)
  if (cached) {
    try { return JSON.parse(cached.body) } catch { /* fall through and refetch */ }
  }

  const host = new URL(url).host
  const gate = await throttle(host, HOST_GAP[host] ?? 200)
  let lastErr
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchText(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
          timeout: 15000,
        })
        if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status)
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status} for ${url}: ${res.text.slice(0, 200)}`)
          err.status = res.status
          throw err
        }
        const body = res.text
        run(
          `INSERT INTO http_cache (key, body, fetched_at, expires_at)
           VALUES (?, ?, datetime('now'), datetime('now', ?))
           ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
          key, body, `+${Math.round(ttlSeconds)} seconds`,
        )
        return JSON.parse(body)
      } catch (err) {
        lastErr = err
        if (err.status && err.status < 500 && err.status !== 429) break
        if (attempt < retries) await new Promise((r) => setTimeout(r, 700 * (attempt + 1) ** 2))
      }
    }
  } finally {
    gate.done()
  }
  throw lastErr
}

export function clearCache() {
  run('DELETE FROM http_cache')
}

/*
 * Expired cache rows were never removed, only ignored. Thousands of stale
 * provider responses had grown the database to 43 MB of which 91% was free
 * space, which slows every query that has to walk past it.
 */
export function pruneCache() {
  const { changes } = run("DELETE FROM http_cache WHERE expires_at <= datetime('now')")
  return changes
}
