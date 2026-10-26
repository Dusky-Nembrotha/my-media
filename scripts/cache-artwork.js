/* Pull every remote cover into the local cache, measuring as it goes. */
import { all, run, get } from '../server/lib/db.js'
import { cacheArtwork, artworkStats } from '../server/lib/artwork.js'

const rows = all("SELECT id, title, poster_url, metadata FROM works WHERE poster_url IS NOT NULL AND poster_url NOT LIKE '/artwork/%'")
console.log(`caching ${rows.length} covers\n`)

let done = 0, failed = 0, poor = 0
for (const row of rows) {
  const art = await cacheArtwork(row.poster_url)
  if (!art?.path) { failed++; continue }
  let meta = {}
  try { meta = JSON.parse(row.metadata || '{}') } catch { meta = {} }
  meta.artwork = { source: row.poster_url, width: art.width ?? null, height: art.height ?? null, quality: art.quality ?? null }
  run('UPDATE works SET poster_url = ?, backdrop_url = COALESCE(backdrop_url, ?), metadata = ? WHERE id = ?',
    art.path, art.path, JSON.stringify(meta), row.id)
  done++
  if (art.quality === 'poor' || art.quality === 'low') poor++
  if (done % 50 === 0) process.stdout.write(`\r  ${done}/${rows.length} cached, ${failed} failed`)
}

const stats = artworkStats()
console.log(`\n\ncached ${done}, failed ${failed}`)
console.log(`${poor} are below 260px wide and will look soft`)
console.log(`on disk: ${stats.files} files, ${(stats.bytes / 1048576).toFixed(1)} MB`)
console.log('still remote:', get("SELECT count(*) c FROM works WHERE poster_url IS NOT NULL AND poster_url NOT LIKE '/artwork/%'").c)
