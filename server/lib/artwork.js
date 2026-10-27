import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, writeFileSync, statSync, readdirSync, unlinkSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { DATA_DIR } from './db.js'
import { dimensionsFrom, qualityOf, MIN_POSTER_WIDTH } from './imagesize.js'
import { fetchBuffer } from './fetchv4.js'

/*
 * Artwork is copied here once and served from this machine thereafter.
 *
 * Two reasons. Open Library's cover CDN regularly takes 15–20 seconds per
 * image, which makes a grid of book covers unusable; and holding the bytes
 * ourselves means we can measure them and tell a crisp cover from a thumbnail
 * someone scanned in 2008.
 */
const ARTWORK_DIR = join(DATA_DIR, 'artwork')
mkdirSync(ARTWORK_DIR, { recursive: true })

export { ARTWORK_DIR, MIN_POSTER_WIDTH }

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }

function nameFor(url, contentType) {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 20)
  const ext = EXT[contentType] || extname(new URL(url).pathname) || '.jpg'
  return `${hash}${ext.length <= 5 ? ext : '.jpg'}`
}

export function cachedPathFor(url) {
  if (!url) return null
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 20)
  for (const ext of ['.jpg', '.png', '.webp', '.gif']) {
    if (existsSync(join(ARTWORK_DIR, hash + ext))) return `/artwork/${hash}${ext}`
  }
  return null
}

export function isCached(url) {
  return Boolean(cachedPathFor(url))
}

/**
 * Download an image, measure it, keep it. Returns where it now lives locally
 * and how good it is, or null if it could not be had.
 */
export async function cacheArtwork(url, { timeout = 30000 } = {}) {
  if (!url || url.startsWith('/artwork/')) return null
  const already = cachedPathFor(url)
  if (already) {
    const full = join(DATA_DIR, already.replace('/artwork/', 'artwork/'))
    try {
      const { size } = statSync(full)
      // Measure from disk: the caller needs the dimensions whether or not we
      // had to go and fetch the bytes.
      const head = readFileSync(full).subarray(0, 65536)
      const dims = dimensionsFrom(head) || {}
      return {
        path: already,
        bytes: size,
        cached: true,
        width: dims.width ?? null,
        height: dims.height ?? null,
        quality: dims.width ? qualityOf({ ok: true, ...dims }) : null,
      }
    } catch { /* fall through and refetch */ }
  }

  try {
    // Open Library in particular is slow enough to need a long leash.
    const res = await fetchBuffer(url, {
      headers: { 'User-Agent': 'Shelved/0.1 (self-hosted personal media log)' },
      timeout,
    })
    if (!res.ok) return null
    const buf = res.body
    if (buf.length < 1024) return null              // a placeholder, not a cover

    const size = dimensionsFrom(buf) || {}
    const file = nameFor(url, res.headers['content-type'] || '')
    writeFileSync(join(ARTWORK_DIR, file), buf)

    return {
      path: `/artwork/${file}`,
      bytes: buf.length,
      width: size.width ?? null,
      height: size.height ?? null,
      quality: qualityOf({ ok: true, ...size }),
    }
  } catch {
    return null
  }
}

/** Measure a remote image using the copy we already hold, if we have one. */
export async function inspect(url) {
  const cached = await cacheArtwork(url)
  if (!cached) return { url, ok: false }
  return { url, ok: true, ...cached }
}

export function artworkStats() {
  try {
    const files = readdirSync(ARTWORK_DIR)
    const bytes = files.reduce((n, f) => n + statSync(join(ARTWORK_DIR, f)).size, 0)
    return { files: files.length, bytes }
  } catch {
    return { files: 0, bytes: 0 }
  }
}

/** Remove cached images nothing points at any more. */
export function pruneArtwork(keepPaths) {
  const keep = new Set(keepPaths.filter(Boolean).map((p) => p.replace('/artwork/', '')))
  let removed = 0
  for (const file of readdirSync(ARTWORK_DIR)) {
    if (keep.has(file)) continue
    try { unlinkSync(join(ARTWORK_DIR, file)); removed++ } catch { /* leave it */ }
  }
  return removed
}
