import { randomBytes } from 'node:crypto'
import { parse as parseSpotify } from '../importers/spotify.js'

/**
 * Spotify uses the authorization-code flow with a redirect. Spotify only
 * permits http:// for loopback addresses, so the redirect goes to
 * 127.0.0.1 and we also accept the redirected URL pasted by hand — which is
 * what you need when you authorise on a phone.
 */
export const id = 'spotify'
export const label = 'Spotify'
export const mediaTypes = ['album', 'track', 'podcast']
export const kind = 'oauth-code'
export const capabilities = ['history', 'library']
export const website = 'https://spotify.com'
export const blurb = 'Keeps the last 50 plays topped up and imports your saved albums. '
  + 'Spotify only exposes recent history over the API, so pair this with a one-off '
  + 'data-download import for the full back catalogue.'

export const fields = [
  { key: 'client_id', label: 'Client ID', secret: false, help: 'From your Spotify dashboard app' },
  { key: 'client_secret', label: 'Client Secret', secret: true },
  { key: 'redirect_uri', label: 'Redirect URI', secret: false, default: 'http://127.0.0.1:4123/api/connections/spotify/callback', help: 'Must match the dashboard exactly' },
]

export const instructions = [
  'Open developer.spotify.com/dashboard and press "Create app".',
  'Name it "Shelved". App description can be anything.',
  'Redirect URI: paste exactly http://127.0.0.1:4123/api/connections/spotify/callback',
  'Tick "Web API", agree to the terms and save.',
  'Copy the Client ID, then "View client secret" and copy that too. Paste both above and save.',
  'Press Connect. If you are authorising from a phone, Spotify will redirect to a page that will not load — copy that whole address and paste it into the box shown.',
]

export const options = [
  { key: 'minPlays', label: 'Only log albums with at least this many track plays', type: 'number', default: 2 },
  { key: 'includePodcasts', label: 'Log podcast shows too', type: 'boolean', default: true },
]

const SCOPES = ['user-read-recently-played', 'user-library-read', 'user-read-email'].join(' ')

function redirectUri(config) {
  return config.redirect_uri || 'http://127.0.0.1:4123/api/connections/spotify/callback'
}

export async function begin({ config }) {
  if (!config.client_id) throw new Error('Add your Spotify Client ID first')
  const state = randomBytes(12).toString('hex')
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: config.client_id,
    scope: SCOPES,
    redirect_uri: redirectUri(config),
    state,
  })
  return {
    mode: 'redirect',
    state,
    authorize_url: url,
    instruction: 'Approve the request on Spotify. If the page it sends you to will not load, copy its address and paste it below.',
  }
}

async function tokenRequest(config, body) {
  const basic = Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error_description || data?.error || `Spotify returned ${res.status}`)
  return data
}

/** Accepts a bare code or the whole redirected URL pasted back in. */
export async function exchange({ config, code }) {
  let value = String(code || '').trim()
  if (value.includes('code=')) {
    try { value = new URL(value).searchParams.get('code') || value } catch { /* keep as typed */ }
  }
  if (!value) throw new Error('No authorisation code found in that')
  const data = await tokenRequest(config, {
    grant_type: 'authorization_code',
    code: value,
    redirect_uri: redirectUri(config),
  })
  return { status: 'connected', tokens: tokensFrom(data) }
}

function tokensFrom(data, previous = {}) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || previous.refresh_token,
    expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
  }
}

export async function refresh({ config, tokens }) {
  if (!tokens?.refresh_token) throw new Error('No refresh token stored — reconnect')
  const data = await tokenRequest(config, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  })
  return tokensFrom(data, tokens)
}

async function api(path, tokens) {
  const res = await fetch('https://api.spotify.com/v1' + path, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(20000),
  })
  if (res.status === 401) { const e = new Error('Spotify token expired'); e.status = 401; throw e }
  if (!res.ok) throw new Error(`Spotify returned ${res.status}`)
  return res.json()
}

export async function account({ tokens }) {
  const me = await api('/me', tokens)
  return me?.display_name || me?.id || null
}

export async function sync({ tokens, options = {} }) {
  const recent = await api('/me/player/recently-played?limit=50', tokens)

  // Reshape into the same records the data-download export produces.
  const history = (recent?.items || []).map((item) => ({
    ts: item.played_at,
    ms_played: item.track?.duration_ms ?? 0,
    master_metadata_track_name: item.track?.name ?? null,
    master_metadata_album_artist_name: item.track?.artists?.[0]?.name ?? null,
    master_metadata_album_album_name: item.track?.album?.name ?? null,
    spotify_track_uri: item.track?.uri ?? null,
  }))

  const saved = await api('/me/albums?limit=50', tokens).catch(() => null)
  const library = {
    albums: (saved?.items || []).map((i) => ({
      album: i.album?.name,
      artist: i.album?.artists?.[0]?.name,
      uri: i.album?.uri,
    })),
    shows: [],
    tracks: [],
  }

  return parseSpotify(
    [
      { filename: 'Streaming_History_Audio_api.json', json: history },
      { filename: 'YourLibrary.json', json: library },
    ],
    { minPlays: Number(options.minPlays ?? 2), includePodcasts: options.includePodcasts !== false },
  )
}
