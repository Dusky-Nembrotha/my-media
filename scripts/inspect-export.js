/*
 * Tells you what is actually inside a Letterboxd (or any) export, and what the
 * importer would make of it — before or after importing.
 *
 *   node scripts/inspect-export.js ~/Downloads/letterboxd-you-2026-10-26.zip
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { explode, detect, parseWith } from '../server/importers/index.js'
import { normaliseTitle } from '../server/lib/util.js'

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/inspect-export.js <path to export .zip or .csv>')
  process.exit(1)
}

const members = explode({ filename: basename(path), buffer: readFileSync(path) })

console.log(`\n${basename(path)} — ${members.length} readable file(s) inside\n`)
console.log('  file'.padEnd(42), 'rows')
console.log('  ' + '-'.repeat(52))
for (const m of members) {
  const rows = m.json !== undefined
    ? (Array.isArray(m.json) ? m.json.length : 1)
    : Math.max(0, m.text.trim().split('\n').length - 1)
  console.log('  ' + m.filename.slice(0, 40).padEnd(42), String(rows).padStart(5))
}

const source = detect(members)[0]
console.log(`\ndetected as: ${source.id} (${Math.round(source.confidence * 100)}%)\n`)

const { records, filesUsed } = parseWith(source.id, members)
console.log('files the importer read:', filesUsed.join(', '), '\n')

const entries = records.filter((r) => r.kind === 'entry')
const recs = records.filter((r) => r.kind === 'rec')
const lists = records.filter((r) => r.kind === 'list')
const distinct = new Set(entries.map((r) => `${r.type}|${normaliseTitle(r.title)}|${r.year || ''}`))
const distinctLoose = new Set(entries.map((r) => `${r.type}|${normaliseTitle(r.title)}`))

console.log(`records parsed:        ${records.length}`)
console.log(`  log entries:         ${entries.length}`)
console.log(`  to check out:        ${recs.length}`)
console.log(`  list memberships:    ${lists.length}`)
console.log(`\ndistinct titles in those entries: ${distinct.size}`)
console.log(`  ignoring the year:              ${distinctLoose.size}`)
console.log(`\n→ importing this would give you about ${distinct.size} titles.`)
if (entries.length > distinct.size) {
  console.log(`  (${entries.length - distinct.size} rows are the same film appearing in more than one file,`)
  console.log('   e.g. in both ratings.csv and watched.csv — those merge into one entry.)')
}

// Which file each entry came from, via its idempotency key.
const byFile = {}
for (const e of entries) {
  const role = String(e.external_key || '').split(':')[1] || '(none)'
  byFile[role] = (byFile[role] || 0) + 1
}
console.log('\nentries by source file:', byFile)
