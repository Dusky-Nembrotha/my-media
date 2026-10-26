import { parse as parseTrakt } from '../importers/trakt.js'

/**
 * Trakt uses the OAuth *device* flow, which suits a self-hosted app on a home
 * network: there is no callback URL to register, you just type a code into
 * trakt.tv on any device.
 */
export const id = 'trakt'
export const label = 'Trakt'
export const mediaTypes = ['film', 'tv']
export const kind = 'oauth-device'
export const capabilities = ['history', 'ratings', 'watchlist']
export const website = 'https://trakt.tv'
export const blurb = 'The best live connection for film and TV: full watch history, '
  + 'your ratings and your watchlist, synced both on demand and whenever you ask.'

export const fields = [
  { key: 'client_id', label: 'Client ID', secret: false, help: 'From your Trakt API app' },
  { key: 'client_secret', label: 'Client Secret', secret: true, help: 'From the same page' },
]

export const instructions = [
  'Sign in at trakt.tv, then open Settings → "Your API Apps" (trakt.tv/oauth/applications).',
  'Press "New Application". Name it anything — "My Media" will do.',
  'For Redirect URI paste exactly: urn:ietf:wg:oauth:2.0:oob',
  'Leave the other boxes empty and save.',
  'Copy the Client ID and Client Secret from the app page into the boxes above, and save.',
  'Press Connect. You will get a short code and a link — open it on any device, sign in and enter the code.',
]

const API = 'https://api.trakt.tv'

async function traktFetch(path, { token, clientId, method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!res.ok) {
    const err = new Error(data?.error_description || data?.error || `Trakt returned ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

/** Step 1: ask Trakt for a code the user types in on trakt.tv/activate. */
export async function begin({ config }) {
  if (!config.client_id) throw new Error('Add your Trakt Client ID first')
  const data = await traktFetch('/oauth/device/code', {
    clientId: config.client_id,
    method: 'POST',
    body: { client_id: config.client_id },
  })
  return {
    mode: 'device',
    device_code: data.device_code,
    user_code: data.user_code,
    verification_url: data.verification_url,
    interval: Math.max(5, data.interval || 5),
    expires_in: data.expires_in,
    instruction: `Open ${data.verification_url} and enter the code ${data.user_code}`,
  }
}

/** Step 2: poll until they have approved it (or it expires). */
export async function poll({ config, pending }) {
  if (!pending?.device_code) throw new Error('Start the connection again')
  try {
    const data = await traktFetch('/oauth/device/token', {
      clientId: config.client_id,
      method: 'POST',
      body: {
        code: pending.device_code,
        client_id: config.client_id,
        client_secret: config.client_secret,
      },
    })
    return { status: 'connected', tokens: tokensFrom(data) }
  } catch (err) {
    // 400 = still waiting, 409 = already used, 418 = denied, 404 = expired
    if (err.status === 400) return { status: 'pending' }
    if (err.status === 409) return { status: 'pending' }
    if (err.status === 418) return { status: 'error', message: 'You declined the request on Trakt' }
    if (err.status === 404) return { status: 'error', message: 'The code expired — start again' }
    throw err
  }
}

function tokensFrom(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + (data.expires_in || 7776000) * 1000).toISOString(),
  }
}

export async function refresh({ config, tokens }) {
  if (!tokens?.refresh_token) throw new Error('No refresh token stored — reconnect')
  const data = await traktFetch('/oauth/token', {
    clientId: config.client_id,
    method: 'POST',
    body: {
      refresh_token: tokens.refresh_token,
      client_id: config.client_id,
      client_secret: config.client_secret,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      grant_type: 'refresh_token',
    },
  })
  return tokensFrom(data)
}

export async function account({ config, tokens }) {
  const me = await traktFetch('/users/me', { token: tokens.access_token, clientId: config.client_id })
  return me?.username || me?.ids?.slug || null
}

export async function revoke({ config, tokens }) {
  if (!tokens?.access_token) return
  await traktFetch('/oauth/revoke', {
    clientId: config.client_id,
    method: 'POST',
    body: { token: tokens.access_token, client_id: config.client_id, client_secret: config.client_secret },
  }).catch(() => {})
}

/**
 * Pull everything down and hand it to the existing Trakt importer — the file
 * and the API return the same JSON, so one parser serves both.
 */
export async function sync({ config, tokens }) {
  const token = tokens.access_token
  const clientId = config.client_id
  const opts = { token, clientId }

  const [movies, shows, ratedMovies, ratedShows, watchMovies, watchShows] = await Promise.all([
    traktFetch('/sync/watched/movies', opts),
    traktFetch('/sync/watched/shows?extended=noseasons', opts).then(() => traktFetch('/sync/watched/shows', opts)),
    traktFetch('/sync/ratings/movies', opts),
    traktFetch('/sync/ratings/shows', opts),
    traktFetch('/sync/watchlist/movies', opts),
    traktFetch('/sync/watchlist/shows', opts),
  ])

  const files = [
    { filename: 'watched_movies.json', json: movies || [] },
    { filename: 'watched_shows.json', json: shows || [] },
    { filename: 'ratings_movies.json', json: ratedMovies || [] },
    { filename: 'ratings_shows.json', json: ratedShows || [] },
    { filename: 'watchlist_movies.json', json: watchMovies || [] },
    { filename: 'watchlist_shows.json', json: watchShows || [] },
  ]

  return parseTrakt(files)
}
