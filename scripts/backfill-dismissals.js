/*
 * Recover what was turned down, for rejections recorded before the engine
 * started keeping it.
 *
 * A block stores only "film|heat" — enough to never show it again, not enough
 * to learn that you keep refusing crime films. This looks each one up and
 * fills in the genres and people, so old rejections count towards the
 * distaste model the same way new ones do.
 *
 * Only an exact title match is accepted. A near-miss would teach the engine
 * the shape of a film you never actually rejected, which is worse than
 * leaving the row empty.
 *
 *   node scripts/backfill-dismissals.js [--apply]
 */
import { all, run } from '../server/lib/db.js'
import * as tmdb from '../server/providers/tmdb.js'
import * as googlebooks from '../server/providers/googlebooks.js'
import * as openlibrary from '../server/providers/openlibrary.js'
import { normaliseTitle } from '../server/lib/util.js'

const apply = process.argv.includes('--apply')
const rows = all('SELECT fingerprint, reason FROM rec_blocks WHERE attrs IS NULL')

if (!rows.length) {
  console.log('\n  Nothing to do — every rejection already carries its attributes.\n')
  process.exit(0)
}
if (!tmdb.hasKey()) {
  console.log('\n  No TMDB key configured — film and TV rejections will be left alone.\n')
}

console.log(`\n  ${rows.length} rejection${rows.length === 1 ? '' : 's'} with nothing recorded about them.`)
console.log(apply ? '  Applying.\n' : '  Dry run — pass --apply to write.\n')

let filled = 0, missed = 0, skipped = 0

for (const row of rows) {
  const [type, ...rest] = row.fingerprint.split('|')
  const title = rest.join('|')
  const same = (a) => normaliseTitle(a || '') === normaliseTitle(title)

  const screen = type === 'film' || type === 'tv'
  const page = type === 'book' || type === 'audiobook'
  if (!screen && !page) {
    console.log(`  ·  ${row.fingerprint}  — no provider for this type, skipped`)
    skipped++
    continue
  }
  if (screen && !tmdb.hasKey()) { skipped++; continue }

  let hit = null
  try {
    if (screen) {
      hit = ((await tmdb.search(type, title, 5)) || []).find((r) => same(r.title)) || null
    } else {
      /*
       * Books twice over: Google's catalogue is cleaner on titles, Open
       * Library's subjects are what the book engine actually matches on, so
       * take whichever answers and prefer the one that carries subjects.
       */
      const [g, o] = await Promise.all([
        googlebooks.hasKey() ? googlebooks.search(title, { limit: 5 }).catch(() => []) : [],
        openlibrary.search(title, { limit: 5 }).catch(() => []),
      ])
      const gh = (g || []).find((r) => same(r.title)) || null
      const oh = (o || []).find((r) => same(r.title)) || null
      hit = (oh?.genres?.length ? oh : null) || gh || oh
    }
  } catch (err) {
    console.log(`  ✗  ${title} — lookup failed: ${err.message}`)
    missed++
    continue
  }

  if (!hit) {
    console.log(`  ?  ${title} — no exact match, left alone`)
    missed++
    continue
  }

  // For screen titles the search result is thin; the detail call carries
  // genres and credits. Book search already returns both.
  let full = hit
  if (screen) {
    try { full = (await tmdb.detail(type, String(hit.tmdb_id ?? hit.id))) || hit } catch { /* use the thin one */ }
  }

  const attrs = {
    genres: (full.genres || []).slice(0, 6),
    creators: (full.creators || []).slice(0, 4),
    year: full.year ?? hit.year ?? null,
    language: full.language ?? null,
  }
  if (!attrs.genres.length && !attrs.creators.length) {
    console.log(`  ?  ${title} — matched but has no genres or people, left alone`)
    missed++
    continue
  }

  console.log(`  ✓  ${title} (${attrs.year ?? '—'}) — ${attrs.genres.join(', ') || 'no genres'}`
    + `${attrs.creators.length ? ` · ${attrs.creators.map((c) => c.name).join(', ')}` : ''}`)
  if (apply) run('UPDATE rec_blocks SET attrs = ? WHERE fingerprint = ?', JSON.stringify(attrs), row.fingerprint)
  filled++
}

console.log(`\n  ${filled} recovered, ${missed} not matched, ${skipped} skipped.`)
console.log(apply ? '  Written.\n' : '  Nothing written — re-run with --apply.\n')
