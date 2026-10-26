// Offline checks of the sync mappers: stub fetch, assert the records.
import { applyRecords } from '../server/importers/apply.js'

const realFetch = globalThis.fetch
const mock = (routes) => {
  globalThis.fetch = async (url) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k))
    if (!key) throw new Error('unexpected request: ' + url)
    return { ok: true, status: 200, json: async () => routes[key], text: async () => JSON.stringify(routes[key]) }
  }
}

console.log('== steam')
mock({
  'GetOwnedGames': {
    response: {
      games: [
        { appid: 620, name: 'Portal 2', playtime_forever: 740, rtime_last_played: 1735689600 },
        { appid: 440, name: 'Team Fortress 2', playtime_forever: 12, rtime_last_played: 1700000000 },
        { appid: 99, name: 'Never Played', playtime_forever: 0, rtime_last_played: 0 },
      ],
    },
  },
})
const steam = await import('../server/connections/steam.js')
let recs = await steam.sync({ config: { api_key: 'k', steam_id: '1' }, options: { minMinutes: 30, unplayedToList: true } })
for (const r of recs) {
  console.log(`  ${r.kind.padEnd(5)} ${String(r.title).padEnd(16)} ${(r.progress || r.note || '').padEnd(14)} ${r.consumed_on || ''} ${r.poster_url ? 'art' : ''}`)
}
console.log('  expected: Portal 2 logged (12h), TF2 skipped (under 30 min), Never Played -> list')

console.log('\n== spotify (recently played -> album entries)')
mock({
  '/me/player/recently-played': {
    items: Array.from({ length: 6 }, (_, i) => ({
      played_at: `2026-10-2${i % 5}T20:0${i}:00Z`,
      track: {
        name: `Track ${i + 1}`, duration_ms: 210000, uri: `spotify:track:x${i}`,
        artists: [{ name: 'Big Thief' }], album: { name: 'Dragon New Warm Mountain', uri: 'spotify:album:a' },
      },
    })),
  },
  '/me/albums': { items: [{ album: { name: 'Endlessness', artists: [{ name: 'Nala Sinephro' }], uri: 'spotify:album:b' } }] },
})
const spotify = await import('../server/connections/spotify.js')
recs = await spotify.sync({ tokens: { access_token: 't' }, options: { minPlays: 2 } })
for (const r of recs) console.log(`  ${r.kind.padEnd(5)} ${r.type.padEnd(6)} ${String(r.title).padEnd(28)} ${r.progress || r.recommender || ''}`)

console.log('\n== lastfm (scrobbles -> albums)')
mock({
  'user.getrecenttracks': {
    recenttracks: {
      '@attr': { totalPages: '1' },
      track: [
        { name: 'Smokestack', artist: { '#text': 'Wolf Alice' }, album: { '#text': 'Blue Weekend' }, date: { uts: '1735689600' } },
        { name: 'Delicious Things', artist: { '#text': 'Wolf Alice' }, album: { '#text': 'Blue Weekend' }, date: { uts: '1735689700' } },
        { name: 'Lipstick', artist: { '#text': 'Wolf Alice' }, album: { '#text': 'Blue Weekend' }, date: { uts: '1735689800' } },
        { name: 'Now Playing', artist: { '#text': 'X' }, album: { '#text': 'Y' }, '@attr': { nowplaying: 'true' } },
      ],
    },
  },
})
const lastfm = await import('../server/connections/lastfm.js')
recs = await lastfm.sync({ config: { username: 'u', api_key: 'k' }, options: { minPlays: 3, maxPages: 1 } })
for (const r of recs) console.log(`  ${r.kind.padEnd(5)} ${r.type.padEnd(6)} ${String(r.title).padEnd(28)} ${r.progress} ${r.consumed_on}`)
console.log('  (the "now playing" row must be excluded)')

globalThis.fetch = realFetch
console.log('\n== idempotency: applying the steam records twice')
mock({ 'GetOwnedGames': { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 740, rtime_last_played: 1735689600 }] } } })
const once = applyRecords(await steam.sync({ config: {}, options: {} }), { source: 'steam', enrich: false })
const twice = applyRecords(await steam.sync({ config: {}, options: {} }), { source: 'steam', enrich: false })
console.log(`  first:  +${once.entriesAdded} entries, +${once.worksAdded} works`)
console.log(`  second: +${twice.entriesAdded} entries, ${twice.entriesSkipped} skipped  ${twice.entriesAdded === 0 ? '✓' : '✗ DUPLICATED'}`)
globalThis.fetch = realFetch
