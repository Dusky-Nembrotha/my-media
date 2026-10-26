import { parse as parseLastfm } from '../importers/lastfm.js'

/**
 * Last.fm needs no OAuth to *read* a public profile — an API key and your
 * username are enough, which makes it the simplest live music connection.
 */
export const id = 'lastfm'
export const label = 'Last.fm'
export const mediaTypes = ['album', 'track']
export const kind = 'api-key'
export const capabilities = ['history']
export const website = 'https://www.last.fm'
export const blurb = 'Your full scrobble history, grouped into albums. No OAuth needed — '
  + 'an API key and your username are enough, as long as your profile is public.'

export const fields = [
  { key: 'api_key', label: 'API key', secret: true, help: 'From last.fm/api/account/create' },
  { key: 'username', label: 'Your Last.fm username', secret: false },
]

export const instructions = [
  'Go to last.fm/api/account/create (sign in first).',
  'Application name: "Shelved". Leave the callback URL empty and submit.',
  'Copy the "API key" it shows you into the box above, along with your username.',
  'Save, then press Connect — your scrobbles are fetched and grouped into albums.',
  'Your Last.fm privacy settings must allow others to see your listening (the default).',
]

export const options = [
  { key: 'minPlays', label: 'Only log albums with at least this many scrobbles', type: 'number', default: 3 },
  { key: 'maxPages', label: 'Pages of history to fetch (200 scrobbles each)', type: 'number', default: 25 },
]

const API = 'https://ws.audioscrobbler.com/2.0/'

async function call(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json' })}`
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) {
    throw new Error(data?.message || `Last.fm returned ${res.status}`)
  }
  return data
}

/** An API key is all there is to check, so "connecting" is a verification call. */
export async function connect({ config }) {
  if (!config.api_key || !config.username) throw new Error('Both the API key and your username are needed')
  const data = await call({ method: 'user.getinfo', user: config.username, api_key: config.api_key })
  if (!data?.user?.name) throw new Error('Last.fm did not recognise that username')
  return { status: 'connected', account: data.user.name, tokens: {} }
}

export async function account({ config }) {
  return config.username || null
}

export async function sync({ config, options = {} }) {
  const maxPages = Math.max(1, Math.min(200, Number(options.maxPages ?? 25)))
  const scrobbles = []

  for (let page = 1; page <= maxPages; page++) {
    const data = await call({
      method: 'user.getrecenttracks',
      user: config.username,
      api_key: config.api_key,
      limit: '200',
      page: String(page),
    })
    const tracks = data?.recenttracks?.track || []
    const list = Array.isArray(tracks) ? tracks : [tracks]
    for (const t of list) {
      if (t['@attr']?.nowplaying) continue      // still playing: not a scrobble yet
      scrobbles.push({
        artist: t.artist?.['#text'] || t.artist?.name || '',
        album: t.album?.['#text'] || '',
        name: t.name,
        date: t.date?.uts ? Number(t.date.uts) : null,
      })
    }
    const totalPages = Number(data?.recenttracks?.['@attr']?.totalPages || 1)
    if (page >= totalPages) break
  }

  // Hand it to the file importer in the shape it already understands.
  return parseLastfm([{ filename: 'lastfm-api.json', json: scrobbles }], options)
}
