/*
 * What people are actually playing.
 *
 * Steam publish their most-played chart and their store catalogue without a
 * key, which between them answer "what is hot in games" better than anything
 * else free: not what is selling or being reviewed, but how many people were
 * in the game at once this week.
 *
 * It is one platform, and so it is one view — no consoles, and nothing from
 * Game Pass or the Epic store. Said plainly in the page's credit rather than
 * dressed up as the whole industry.
 */
import { fetchJson } from '../lib/http.js'
import { parseYear } from '../lib/util.js'

const CHART = 'https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/'
const DETAILS = 'https://store.steampowered.com/api/appdetails'

/** The week's chart: ranks and peak concurrent players, one request. */
export async function mostPlayed() {
  try {
    const data = await fetchJson(CHART, { ttlSeconds: 60 * 60 * 6 })
    return (data?.response?.ranks || []).map((r) => ({
      appid: r.appid,
      rank: r.rank,
      peak: r.peak_in_game ?? null,
      lastWeek: r.last_week_rank ?? null,
    }))
  } catch {
    return []
  }
}

/**
 * One game's store page, normalised.
 *
 * Steam only answers for a single id at a time — asking for several returns
 * a 400 — so this is one request per title and cached for a day.
 */
export async function details(appid, region = 'GB') {
  try {
    const body = await fetchJson(
      `${DETAILS}?appids=${appid}&cc=${String(region).toLowerCase()}&l=en`,
      { ttlSeconds: 60 * 60 * 24 },
    )
    const d = body?.[String(appid)]?.data
    if (!d?.name) return null

    return {
      provider: 'steam',
      type: 'game',
      title: d.name,
      year: parseYear(d.release_date?.date),
      release_date: null,
      creators: [
        ...(d.developers || []).slice(0, 2).map((name) => ({ role: 'Developer', name })),
        ...(d.publishers || []).slice(0, 1).map((name) => ({ role: 'Publisher', name })),
      ],
      genres: (d.genres || []).map((g) => g.description).filter(Boolean).slice(0, 3),
      overview: String(d.short_description || '').trim() || null,
      /*
       * Steam's store page offers the wide capsule, which is 460x215 and
       * would be butchered by a portrait frame. The library art is 600x900 —
       * the same shape as every other cover here — and is published at a
       * predictable address, so the shelf gets a proper box shot and the
       * capsule becomes the backdrop it was always better suited to being.
       */
      poster_url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
      backdrop_url: d.header_image || d.background_raw || null,
      // Metacritic is out of 100 and everything else here is out of 10.
      external_rating: d.metacritic?.score ? d.metacritic.score / 10 : null,
      language: 'en',
      metadata: {
        steam_appid: appid,
        steam_url: `https://store.steampowered.com/app/${appid}/`,
        metacritic: d.metacritic?.score ?? null,
        countries: [],
        vote_count: null,
      },
    }
  } catch {
    return null
  }
}

/**
 * The chart, resolved.
 *
 * Only as many as are asked for: each one is a request, so fetching a hundred
 * to show eighteen is eighty-two requests nobody reads. Cached for a day, so
 * the cost is paid once.
 */
export async function charts({ limit = 60, region = 'GB' } = {}) {
  const ranks = await mostPlayed()
  if (!ranks.length) return []

  const out = []
  const BATCH = 6
  const wanted = ranks.slice(0, limit)
  for (let i = 0; i < wanted.length; i += BATCH) {
    const slice = wanted.slice(i, i + BATCH)
    const got = await Promise.all(slice.map((r) => details(r.appid, region)))
    got.forEach((item, j) => {
      if (!item) return
      const r = slice[j]
      out.push({
        ...item,
        // Climbing the chart is the interesting part of a chart.
        popularity: r.peak ?? null,
        metadata: { ...item.metadata, peak_players: r.peak, rank: r.rank, last_week_rank: r.lastWeek },
      })
    })
  }
  return out
}
