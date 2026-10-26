import { queueAll, state } from '../server/enrich.js'
import { get } from '../server/lib/db.js'

const n = queueAll({ onlyMissing: true })
console.log(`queued ${n} works for enrichment`)
let last = -1
while (state.pending > 0) {
  if (state.done !== last) {
    last = state.done
    process.stdout.write(`\r  ${state.done} done, ${state.failed} failed, ${state.pending} pending — ${String(state.lastTitle || '').slice(0, 40).padEnd(42)}`)
  }
  await new Promise((r) => setTimeout(r, 500))
}
console.log('\n\nwith posters:', get('SELECT count(*) c FROM works WHERE poster_url IS NOT NULL').c, 'of', get('SELECT count(*) c FROM works').c)
console.log('with genres :', get("SELECT count(*) c FROM works WHERE genres != '[]'").c)
console.log('with creators:', get("SELECT count(*) c FROM works WHERE creators != '[]'").c)
