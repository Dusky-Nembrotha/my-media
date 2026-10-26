import { queueEnrichment, state } from '../server/enrich.js'
import { all, get } from '../server/lib/db.js'

const ids = all("SELECT id FROM works WHERE type IN ('film','tv','game')").map((r) => r.id)
queueEnrichment(ids)
console.log('re-enriching', ids.length, 'screen titles')
while (state.pending > 0) {
  process.stdout.write(`\r  ${state.done} done, ${state.pending} pending — ${String(state.lastTitle || '').slice(0, 38).padEnd(40)}`)
  await new Promise((r) => setTimeout(r, 400))
}
console.log('\n')
for (const row of all("SELECT title, creators FROM works WHERE type = 'film' ORDER BY random() LIMIT 6")) {
  const c = JSON.parse(row.creators)
  console.log(' ', row.title.padEnd(32), c.slice(0, 2).map((x) => `${x.name} (${x.role})`).join(', '))
}
console.log('films with a director:', get("SELECT count(*) c FROM works WHERE type='film' AND creators LIKE '%Director%'").c, 'of', get("SELECT count(*) c FROM works WHERE type='film'").c)
