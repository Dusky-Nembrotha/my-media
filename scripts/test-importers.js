import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { explode, detect, parseWith } from '../server/importers/index.js'

const root = join(import.meta.dirname, '..', 'samples')
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

const groups = {
  letterboxd: walk(join(root, 'letterboxd')),
  goodreads: [join(root, 'goodreads_library_export.csv')],
  audible: [join(root, 'Audible.Library.csv')],
  imdb: [join(root, 'imdb_ratings.csv')],
  trakt: [join(root, 'trakt_watched_shows.json')],
  spotify: walk(join(root, 'spotify')),
  netflix: [join(root, 'NetflixViewingHistory.csv')],
}

for (const [name, paths] of Object.entries(groups)) {
  const files = paths.flatMap((p) => explode({ filename: relative(root, p), buffer: readFileSync(p) }))
  const ranked = detect(files)
  const top = ranked[0]
  const { records } = parseWith(top.id, files)
  const kinds = {}
  const types = {}
  for (const r of records) { kinds[r.kind] = (kinds[r.kind] || 0) + 1; types[r.type] = (types[r.type] || 0) + 1 }
  const rated = records.filter((r) => r.rating != null)
  console.log(`\n== ${name}`)
  console.log(`   detected: ${top.id} (${(top.confidence * 100).toFixed(0)}% — ${top.reason})`)
  console.log(`   runners-up: ${ranked.slice(1, 3).map((r) => `${r.id} ${(r.confidence * 100).toFixed(0)}%`).join(', ') || 'none'}`)
  console.log(`   records: ${records.length}`, kinds, types)
  console.log(`   rated: ${rated.length}, dated: ${records.filter((r) => r.consumed_on).length}, reviews: ${records.filter((r) => r.review).length}`)
  for (const r of records.slice(0, 3)) {
    console.log(`     · ${r.kind.padEnd(5)} ${r.type.padEnd(9)} ${String(r.title).slice(0, 44).padEnd(46)} ${r.year || '----'}  ${r.rating ?? '-'}★  ${r.consumed_on || ''} ${r.progress || ''}`)
  }
}
