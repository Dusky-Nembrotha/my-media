/*
 * The cover the recording was sold under, and who read it.
 *
 * A book and its audiobook are one work here, so there is one cover — the
 * print one, because that is what the book sources return. On the audiobook
 * shelf that is the wrong picture and the wrong credit: the artwork differs,
 * often considerably, and the person who matters most is the narrator.
 *
 * Apple's catalogue is keyless and carries both. Only works with an audiobook
 * entry are looked up, and only an exact title match by the same author is
 * accepted — a near miss would put another edition's artwork on your shelf.
 *
 *   node scripts/fetch-audiobook-art.js [--apply] [--limit N]
 */
import { all, run, get } from '../server/lib/db.js'
import * as itunes from '../server/providers/itunes.js'
import { normaliseTitle } from '../server/lib/util.js'

const apply = process.argv.includes('--apply')
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0

const rows = all(`
  SELECT w.id, w.title, w.creators, w.metadata
    FROM works w
   WHERE w.type = 'book'
     AND EXISTS (SELECT 1 FROM entries e WHERE e.work_id = w.id AND e.format IN ('audiobook', 'both'))
     AND (json_extract(w.metadata, '$.audiobook_poster_url') IS NULL)
   ORDER BY w.id
`)

const todo = limit ? rows.slice(0, limit) : rows
console.log(`\n  ${rows.length} audiobooks without their own artwork${limit ? `, doing ${todo.length}` : ''}.`)
console.log(apply ? '  Applying.\n' : '  Dry run — pass --apply to write.\n')

const firstAuthor = (json) => {
  try { return (JSON.parse(json || '[]').find((c) => c.role === 'Author') || {}).name || null } catch { return null }
}
const surname = (name) => String(name || '').trim().split(/\s+/).pop()?.toLowerCase() || ''

let found = 0, missed = 0

for (const w of todo) {
  const author = firstAuthor(w.creators)
  let hits = []
  try {
    hits = await itunes.search('audiobook', [w.title, author].filter(Boolean).join(' '), 5) || []
  } catch (err) {
    console.log(`  ✗  ${w.title.slice(0, 40)} — ${err.message}`)
    missed++
    continue
  }

  const hit = hits.find((h) => {
    if (normaliseTitle(h.title) !== normaliseTitle(w.title)) return false
    if (!author) return true
    // Same book, same hand. Surnames, because Apple writes authors every way.
    const names = (h.creators || []).map((c) => surname(c.name))
    return names.includes(surname(author))
  })

  if (!hit?.poster_url) {
    console.log(`  ?  ${w.title.slice(0, 44).padEnd(46)} no confident match`)
    missed++
    continue
  }

  let metadata
  try { metadata = JSON.parse(w.metadata || '{}') } catch { metadata = {} }
  metadata.audiobook_poster_url = hit.poster_url
  // Apple files the author under artistName and does not publish the narrator
  // at all, so that credit only ever comes from Audible or the file tags.
  if (!metadata.audio_minutes && hit.runtime) metadata.audio_minutes = hit.runtime

  console.log(`  ✓  ${w.title.slice(0, 44).padEnd(46)}${(metadata.narrators || []).slice(0, 1).join('') || '—'}`)
  if (apply) {
    run("UPDATE works SET metadata = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(metadata), w.id)
  }
  found++
}

console.log(`\n  ${found} matched, ${missed} left alone.`)
console.log(apply ? '  Written.\n' : '  Nothing written — re-run with --apply.\n')
