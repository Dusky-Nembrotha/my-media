import { record, keyFor } from '../importers/shared.js'
import { normaliseTitle } from '../lib/util.js'

/**
 * Steam needs only a Web API key and your SteamID — no OAuth — and gives
 * playtime per game, which is a far better signal than a purchase list.
 */
export const id = 'steam'
export const label = 'Steam'
export const mediaTypes = ['game']
export const brand = '#66c0f4'
export const kind = 'api-key'
export const capabilities = ['history']
export const website = 'https://store.steampowered.com'
export const blurb = 'Every game you own with how long you have played it. Anything you have '
  + 'actually played is logged; the rest can go on your list instead.'

export const fields = [
  { key: 'api_key', label: 'Steam Web API key', secret: true, help: 'From steamcommunity.com/dev/apikey' },
  { key: 'steam_id', label: 'Your SteamID64', secret: false, help: 'The 17-digit number from steamid.io' },
]

export const instructions = [
  'Go to steamcommunity.com/dev/apikey and sign in. Domain can be "localhost".',
  'Copy the key it gives you into the box above.',
  'Find your SteamID64: paste your profile URL into steamid.io and copy the 17-digit "steamID64".',
  'Your Steam profile and game details must be set to Public (Profile → Edit → Privacy).',
  'Save and press Connect.',
]

export const options = [
  { key: 'minMinutes', label: 'Only log games played for at least this many minutes', type: 'number', default: 30 },
  { key: 'unplayedToList', label: 'Put unplayed games on your "to check out" list', type: 'boolean', default: false },
]

async function call(path, params) {
  const url = `https://api.steampowered.com${path}?${new URLSearchParams(params)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Steam returned ${res.status}${res.status === 403 ? ' — check the key and that your profile is public' : ''}`)
  return res.json()
}

export async function connect({ config }) {
  if (!config.api_key || !config.steam_id) throw new Error('Both the API key and your SteamID are needed')
  const data = await call('/ISteamUser/GetPlayerSummaries/v2/', { key: config.api_key, steamids: config.steam_id })
  const player = data?.response?.players?.[0]
  if (!player) throw new Error('Steam did not recognise that SteamID')
  return { status: 'connected', account: player.personaname, tokens: {} }
}

export async function account({ config }) {
  const data = await call('/ISteamUser/GetPlayerSummaries/v2/', { key: config.api_key, steamids: config.steam_id })
  return data?.response?.players?.[0]?.personaname || null
}

export async function sync({ config, options = {} }) {
  const minMinutes = Number(options.minMinutes ?? 30)
  const unplayedToList = Boolean(options.unplayedToList)

  const data = await call('/IPlayerService/GetOwnedGames/v1/', {
    key: config.api_key,
    steamid: config.steam_id,
    include_appinfo: '1',
    include_played_free_games: '1',
  })
  const games = data?.response?.games || []

  return games.map((g) => {
    const minutes = g.playtime_forever || 0
    const played = minutes >= minMinutes
    if (!played && !unplayedToList) return null

    const base = {
      type: 'game',
      title: g.name,
      // Steam's own library art, which is already the right shape for a poster.
      poster_url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_600x900.jpg`,
      backdrop_url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
      metadata: {
        steam_appid: g.appid,
        steam_url: `https://store.steampowered.com/app/${g.appid}/`,
        playtime_minutes: minutes,
        playtime_2weeks: g.playtime_2weeks || 0,
      },
    }

    if (!played) {
      return record({
        ...base,
        kind: 'rec',
        note: minutes > 0 ? `${minutes} minutes played so far` : null,
        recommender: minutes > 0
          ? `In your Steam library, barely played (${minutes} min)`
          : 'In your Steam library, never started',
        source_url: base.metadata.steam_url,
        external_key: keyFor('steam', 'unplayed', [String(g.appid)]),
      })
    }

    return record({
      ...base,
      kind: 'entry',
      status: 'completed',
      consumed_on: g.rtime_last_played
        ? new Date(g.rtime_last_played * 1000).toISOString().slice(0, 10)
        : null,
      progress: minutes >= 60 ? `${Math.round(minutes / 60)} h played` : `${minutes} min played`,
      runtime: minutes,
      merge: true,
      external_key: keyFor('steam', 'played', [String(g.appid) || normaliseTitle(g.name)]),
    })
  }).filter(Boolean)
}
