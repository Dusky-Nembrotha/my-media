import { record, keyFor, rollUpEpisodes } from '../importers/shared.js'
import { normaliseTitle } from '../lib/util.js'
import { fetchText } from '../lib/fetchv4.js'

/**
 * Plex Media Server, on your own network.
 *
 * Plex keeps a complete watch history — every film and every episode, with the
 * date you watched it — and your own star ratings alongside. Both are read
 * straight from the server over your LAN, so nothing goes via plex.tv and
 * there is no OAuth dance: a server URL and a token are enough.
 *
 * Episodes are grouped per show and season, the same as the Netflix import, so
 * a binge is one line in the diary rather than thirteen.
 */
export const id = 'plex'
export const label = 'Plex'
export const mediaTypes = ['film', 'tv']
export const brand = '#e5a00d'
export const kind = 'oauth-device'
export const capabilities = ['history', 'ratings']
export const website = 'https://plex.tv'
export const blurb = 'Your Plex watch history — films and episodes with the dates you watched them — '
  + 'plus any star ratings you have given. Press Connect and approve it on plex.tv; '
  + 'your server is then found automatically and read over your own network.'

/*
 * Nothing is required up front. Plex's link flow hands back an account token,
 * and the account knows which servers you own — so there is no address to look
 * up and no token to go hunting for in a hidden XML page.
 *
 * The address is still offered as an override, for a server reachable on an
 * address plex.tv does not advertise.
 */
export const fields = [
  {
    key: 'server_url',
    label: 'Server address (optional)',
    secret: false,
    required_for_connect: false,
    optional: true,
    help: 'Leave blank to use the server your Plex account points at, e.g. http://192.168.1.124:32400',
  },
]

export const instructions = [
  'Press Connect. You will get a short code and a link.',
  'Open the link on any device, sign in to Plex and approve the request.',
  'Your server is found automatically from your account — no address or token to copy.',
  'Sync reads the full watch history and your star ratings. Run it again any time; only new watches are added.',
  'If your server is only reachable on an address Plex does not advertise, put that address in the box above.',
]

export const options = [
  { key: 'profile', label: 'Only this Plex profile (leave blank for all)', type: 'text', default: '' },
  { key: 'maxPages', label: 'Pages of history to read (500 watches each)', type: 'number', default: 20 },
  { key: 'includeRatings', label: 'Bring across your Plex star ratings', type: 'boolean', default: true },
]

/*
 * A stable identifier for this installation. Plex ties the token to it, and
 * shows it in "Authorised devices", so it wants to be recognisable and to stay
 * the same between restarts.
 */
const CLIENT_ID = 'shelved-self-hosted-media-log'
const PLEX_HEADERS = {
  'X-Plex-Client-Identifier': CLIENT_ID,
  'X-Plex-Product': 'Shelved',
  'X-Plex-Version': '0.1',
  'X-Plex-Device': 'Shelved',
  'X-Plex-Platform': 'Node',
  Accept: 'application/json',
}

async function plexTv(path, { method = 'GET', token = null, params = {} } = {}) {
  const url = new URL(`https://plex.tv${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetchText(url.toString(), {
    method,
    headers: { ...PLEX_HEADERS, ...(token ? { 'X-Plex-Token': token } : {}) },
    timeout: 20000,
  })
  if (res.status === 401) throw new Error('Plex rejected that sign-in')
  if (!res.ok) {
    const err = new Error(`plex.tv returned ${res.status}`)
    err.status = res.status
    throw err
  }
  try {
    return JSON.parse(res.text)
  } catch {
    throw new Error('plex.tv did not return JSON')
  }
}

/** Step 1: ask Plex for a code to approve at plex.tv/link. */
export async function begin() {
  const pin = await plexTv('/api/v2/pins', { method: 'POST' })
  if (!pin?.id || !pin?.code) throw new Error('Plex did not issue a code')
  return {
    mode: 'device',
    device_code: String(pin.id),
    user_code: pin.code,
    verification_url: 'https://plex.tv/link',
    interval: 5,
    expires_in: 900,
    instruction: `Open https://plex.tv/link and enter the code ${pin.code}`,
  }
}

/** Step 2: poll until it has been approved, then find the server. */
export async function poll({ config, pending }) {
  if (!pending?.device_code) throw new Error('Start the connection again')

  let pin
  try {
    pin = await plexTv(`/api/v2/pins/${pending.device_code}`)
  } catch (err) {
    if (err.status === 404) return { status: 'error', message: 'The code expired — start again' }
    throw err
  }
  if (!pin?.authToken) return { status: 'pending' }

  const token = pin.authToken
  const server = await findServer(token, config?.server_url)
  if (!server) {
    return {
      status: 'error',
      message: 'Signed in, but no Plex Media Server could be reached. '
        + 'Put its address in the box above (for example http://192.168.1.124:32400) and try again.',
    }
  }

  return {
    status: 'connected',
    account: server.owner ? `${server.owner} · ${server.name}` : server.name,
    tokens: { access_token: token },
    config: { server_url: server.uri },
    detail: { server: server.name, uri: server.uri },
  }
}

/**
 * Which address actually answers.
 *
 * plex.tv lists every way a server can be reached — a LAN address, a public
 * one, and a relay. The LAN one is tried first: it is the fastest and keeps
 * the traffic off the internet entirely. Each is tested rather than assumed,
 * because the advertised list includes addresses that only work from
 * elsewhere.
 */
async function findServer(token, override) {
  const candidates = []

  if (override) {
    const url = String(override).trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(url)) throw new Error('The address needs to start with http:// or https://')
    candidates.push({ uri: url, name: 'your server', local: true, owner: null })
  }

  let resources = []
  try {
    resources = await plexTv('/api/v2/resources', { token, params: { includeHttps: 1, includeRelay: 1 } })
  } catch { /* an override alone is enough */ }

  for (const r of resources || []) {
    if (r.provides && !String(r.provides).split(',').includes('server')) continue
    if (r.owned === false) continue
    for (const c of r.connections || []) {
      if (!c.uri) continue
      candidates.push({
        uri: c.uri.replace(/\/+$/, ''),
        name: r.name || 'Plex',
        owner: r.sourceTitle || null,
        local: Boolean(c.local),
        relay: Boolean(c.relay),
      })
    }
  }

  // Local first, then direct remote, then the relay as a last resort.
  candidates.sort((a, b) => (b.local - a.local) || (Number(a.relay) - Number(b.relay)))

  for (const candidate of candidates) {
    try {
      const res = await fetchText(`${candidate.uri}/identity`, {
        headers: { ...PLEX_HEADERS, 'X-Plex-Token': token },
        timeout: 6000,
      })
      if (res.ok && res.text.includes('machineIdentifier')) return candidate
    } catch { /* try the next address */ }
  }
  return null
}

function base(config, tokens) {
  const url = String(config?.server_url || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('No Plex server address — connect again to find it')
  if (!/^https?:\/\//i.test(url)) throw new Error('The address needs to start with http:// or https://')
  return url
}

async function call(config, tokens, path, params = {}) {
  const url = new URL(base(config, tokens) + path)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }

  let res
  try {
    res = await fetchText(url.toString(), {
      headers: { ...PLEX_HEADERS, 'X-Plex-Token': tokens?.access_token || '' },
      timeout: 20000,
    })
  } catch (err) {
    throw new Error(`Could not reach Plex at ${base(config, tokens)} — ${err.message}`)
  }

  if (res.status === 401) throw new Error('Plex rejected the stored sign-in — connect again')
  if (!res.ok) throw new Error(`Plex returned ${res.status}`)
  try {
    return JSON.parse(res.text)?.MediaContainer ?? {}
  } catch {
    throw new Error('Plex did not return JSON — check the address points at the server, not the web app')
  }
}

export async function account({ config, tokens }) {
  try {
    const accounts = await call(config, tokens, '/accounts')
    return (accounts.Account || []).map((a) => a.name).filter(Boolean)[0] || null
  } catch {
    return null
  }
}

/*
 * Plex falls back to the filename for anything its own matcher could not
 * identify, so the history contains entries like
 * "Mogs.Christmas.2023.1080p.ALL4.WEB-DL.AAC2.0.H.264-NGP". Logging that
 * verbatim gives a library full of gibberish that no provider can match, so
 * the release tags are cut off and the dots turned back into spaces.
 */
const RELEASE_JUNK = /\b(?:\d{3,4}p|4k|uhd|hdr|web[- .]?dl|web ?rip|blu[- .]?ray|bdrip|dvdrip|hdtv|x26[45]|h\.?26[45]|hevc|xvid|aac\d?(?:\.\d)?|ac3|dts(?:[- .]hd)?|ddp?5\.1|atmos|remux|proper|repack|extended|internal|amzn|nf|dsnp|all4|iplayer)\b/i

function cleanTitle(raw) {
  let title = String(raw || '').trim()
  if (!title) return { title: '', year: null }

  // A filename rather than a title: no spaces, but plenty of separators.
  if (!title.includes(' ') && /[._]/.test(title)) title = title.replace(/[._]+/g, ' ')

  // Everything from the first release tag onwards is packaging, not a title.
  const words = title.split(/\s+/)
  const cut = words.findIndex((w) => RELEASE_JUNK.test(w))
  if (cut > 0) title = words.slice(0, cut).join(' ')

  // A bare year at the end is the release year, not part of the name.
  let year = null
  const m = title.match(/\s\(?((?:19|20)\d{2})\)?$/)
  if (m) {
    year = Number(m[1])
    title = title.slice(0, m.index).trim()
  }

  return { title: title.replace(/[-–\s]+$/, '').trim(), year }
}

/** Plex stores dates as unix seconds; the diary wants YYYY-MM-DD. */
function dayOf(viewedAt) {
  if (!viewedAt) return null
  const d = new Date(Number(viewedAt) * 1000)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Plex rates out of ten; Shelved out of five. */
function starsOf(userRating) {
  const n = Number(userRating)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round((n / 2) * 2) / 2
}

export async function sync({ config, tokens, options = {} }) {
  const maxPages = Math.max(1, Math.min(200, Number(options.maxPages ?? 20)))
  const pageSize = 500

  let accountId = null
  if (options.profile) {
    const accounts = await call(config, tokens, '/accounts')
    const hit = (accounts.Account || []).find(
      (a) => String(a.name || '').toLowerCase() === String(options.profile).toLowerCase(),
    )
    if (!hit) throw new Error(`No Plex profile called "${options.profile}"`)
    accountId = hit.id
  }

  // ---- watch history
  const watches = []
  for (let page = 0; page < maxPages; page++) {
    const data = await call(config, tokens, '/status/sessions/history/all', {
      sort: 'viewedAt:desc',
      'X-Plex-Container-Start': page * pageSize,
      'X-Plex-Container-Size': pageSize,
      accountID: accountId,
    })
    const rows = data.Metadata || []
    watches.push(...rows)
    if (rows.length < pageSize) break
  }

  // ---- your own ratings, which the history does not carry
  const ratings = new Map()
  if (options.includeRatings !== false) {
    try {
      const sections = await call(config, tokens, '/library/sections')
      for (const section of sections.Directory || []) {
        if (!['movie', 'show'].includes(section.type)) continue
        const data = await call(config, tokens, `/library/sections/${section.key}/all`, {
          type: section.type === 'show' ? 2 : 1,
          'X-Plex-Container-Size': 2000,
        })
        for (const item of data.Metadata || []) {
          const stars = starsOf(item.userRating)
          if (stars == null) continue
          const type = section.type === 'show' ? 'tv' : 'film'
          ratings.set(`${type}|${normaliseTitle(item.title)}`, stars)
        }
      }
    } catch { /* ratings are a bonus; a history-only sync is still worth having */ }
  }

  const films = []
  const episodeRows = []

  for (const row of watches) {
    const day = dayOf(row.viewedAt)
    if (row.type === 'movie') {
      const cleaned = cleanTitle(row.title)
      const title = cleaned.title
      if (!title) continue
      films.push(record({
        type: 'film',
        title,
        year: row.year ?? cleaned.year ?? null,
        consumed_on: day,
        rating: ratings.get(`film|${normaliseTitle(title)}`) ?? null,
        metadata: { source: 'plex', plex_rating_key: row.ratingKey ?? null },
        // One watch per title per day: a film restarted after a break is not
        // two viewings, but a genuine rewatch months later is.
        external_key: keyFor('plex', 'film', [normaliseTitle(title), day || '']),
      }))
    } else if (row.type === 'episode') {
      const show = cleanTitle(row.grandparentTitle || row.parentTitle).title
      if (!show) continue
      episodeRows.push({
        type: 'tv',
        title: show,
        season: row.parentIndex ?? null,
        episode: row.index ?? null,
        consumed_on: day,
        rating: ratings.get(`tv|${normaliseTitle(show)}`) ?? null,
        metadata: { source: 'plex' },
      })
    }
  }

  const records = [...films, ...rollUpEpisodes(episodeRows, { source: 'plex' })]

  // Anything rated in Plex but never played still belongs in the library.
  const seen = new Set(records.map((r) => `${r.type}|${normaliseTitle(r.title)}`))
  for (const [key, stars] of ratings) {
    if (seen.has(key)) continue
    const [type, title] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)]
    records.push(record({
      type,
      title,
      rating: stars,
      consumed_on: null,
      metadata: { source: 'plex', rating_only: true },
      external_key: keyFor('plex', `${type}-rating`, [title]),
    }))
  }

  // A plain array, like every other connector: the sync route hands whatever
  // comes back straight to applyRecords, which counts on it being one.
  return records
}
