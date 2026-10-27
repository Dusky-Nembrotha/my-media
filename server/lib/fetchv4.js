import https from 'node:https'
import http from 'node:http'
import dns from 'node:dns'
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib'

/**
 * A small JSON fetcher that goes through node:https rather than global fetch,
 * because two things matter here that fetch gives no control over:
 *
 *  1. Name resolution family. An AF_UNSPEC getaddrinfo call stalls for five
 *     seconds on hosts whose nsswitch has nss-mdns ahead of dns — which is the
 *     Raspberry Pi default. Asking for IPv4 only sidesteps it entirely, and
 *     every provider here is reachable over IPv4.
 *  2. Connection reuse. A keep-alive agent means one TLS handshake per host
 *     instead of one per request, which is the difference between a snappy
 *     search and a slow one on modest hardware.
 *
 * Resolutions are also cached in-process, so a burst of provider calls pays
 * for at most one lookup per host.
 */
const DNS_TTL_MS = 5 * 60 * 1000
const dnsCache = new Map()

function lookup(hostname, options, callback) {
  const hit = dnsCache.get(hostname)
  if (hit && hit.until > Date.now()) {
    if (options?.all) return callback(null, hit.all)
    return callback(null, hit.all[0].address, 4)
  }
  dns.lookup(hostname, { family: 4, all: true }, (err, addresses) => {
    if (err) return callback(err)
    dnsCache.set(hostname, { all: addresses, until: Date.now() + DNS_TTL_MS })
    if (options?.all) return callback(null, addresses)
    callback(null, addresses[0].address, 4)
  })
}

const agentOpts = { keepAlive: true, keepAliveMsecs: 30_000, maxSockets: 8, lookup }
const agents = { 'https:': new https.Agent(agentOpts), 'http:': new http.Agent(agentOpts) }

function decode(buf, encoding) {
  try {
    if (encoding === 'gzip') return gunzipSync(buf)
    if (encoding === 'br') return brotliDecompressSync(buf)
    if (encoding === 'deflate') return inflateSync(buf)
  } catch { /* fall back to the raw bytes */ }
  return buf
}

/** Resolves to `{ status, ok, headers, body }` (a Buffer); rejects on transport failure. */
export function fetchBuffer(target, { headers = {}, timeout = 15000, redirects = 3, method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target)
    const mod = url.protocol === 'http:' ? http : https
    const req = mod.request(
      url,
      {
        method,
        agent: agents[url.protocol],
        headers: {
          'Accept-Encoding': 'gzip, br, deflate',
          ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...headers,
        },
        timeout,
      },
      (res) => {
        const loc = res.headers.location
        if (loc && res.statusCode >= 300 && res.statusCode < 400 && redirects > 0) {
          res.resume()
          return fetchBuffer(new URL(loc, url).toString(), {
            headers, timeout, redirects: redirects - 1, method, body,
          })
            .then(resolve, reject)
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const body = decode(Buffer.concat(chunks), res.headers['content-encoding'])
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: res.headers,
            body,
          })
        })
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error(`Timed out after ${timeout}ms: ${url.host}`)))
    req.on('error', reject)
    req.end(body ?? undefined)
  })
}

/** The same, decoded as UTF-8 text. */
export async function fetchText(target, options) {
  const res = await fetchBuffer(target, options)
  return { ...res, text: res.body.toString('utf8') }
}
