/* Replace soft covers with the largest alternative any provider offers. */
import { all, get, run } from '../server/lib/db.js'
import { hydrate } from '../server/lib/works.js'
import { cacheArtwork } from '../server/lib/artwork.js'
import { tmdb, ol, itunes } from '../server/providers/index.js'

const targets = all(`
  SELECT id FROM works
   WHERE json_extract(metadata, '$.artwork.quality') IN ('poor', 'low')
     AND json_extract(metadata, '$.artwork.chosen') IS NULL`)

console.log(`checking ${targets.length} soft covers for something better\n`)
let improved = 0

for (const { id } of targets) {
  const work = hydrate(get('SELECT * FROM works WHERE id = ?', id))
  if (!work) continue
  const author = work.creators.find((c) => ['Author', 'Artist', 'Director'].includes(c.role))?.name
  let options = []
  try {
    if ((work.type === 'film' || work.type === 'tv') && work.tmdb_id) options = await tmdb.images(work.type, work.tmdb_id)
    else if (work.type === 'book' || work.type === 'audiobook') options = await ol.editionCovers(work.title, author, 5)
    else options = (await itunes.search(work.type, [work.title, author].filter(Boolean).join(' '), 4))
      .filter((h) => h.poster_url).map((h) => ({ url: h.poster_url }))
  } catch { continue }

  let best = null
  for (const option of options.slice(0, 5)) {
    const art = await cacheArtwork(option.url, { timeout: 40000 })
    if (!art?.width) continue
    if (!best || art.width > best.width) best = { ...art, source: option.url }
  }

  const before = work.metadata?.artwork?.width ?? 0
  if (!best || best.width <= before) {
    console.log(`  —  ${work.title.slice(0, 40).padEnd(42)} nothing better than ${before}px`)
    continue
  }
  run(
    "UPDATE works SET poster_url = ?, backdrop_url = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?",
    best.path, best.path,
    JSON.stringify({ ...work.metadata, artwork: { source: best.source, width: best.width, height: best.height, quality: best.quality } }),
    id,
  )
  improved++
  console.log(`  ✓  ${work.title.slice(0, 40).padEnd(42)} ${before}px → ${best.width}px`)
}

console.log(`\nimproved ${improved} of ${targets.length}`)
console.log('still soft:', get("SELECT count(*) c FROM works WHERE json_extract(metadata,'$.artwork.quality') IN ('poor','low')").c)
