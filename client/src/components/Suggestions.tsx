import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { PosterArt, PosterSkeleton } from './Poster'
import { Empty } from './Modal'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { SECTION_META, creatorLine } from '../lib/format'
import type { MediaType, Pick } from '../lib/types'

interface RecResponse {
  type: MediaType
  picks: Pick[]
  cached?: boolean
  profileThin?: boolean
  usingTmdb?: boolean
  usingCrowd?: boolean
  crowdSize?: number
  candidateCount?: number
  computed_at?: string
}

/**
 * What the taste engine thinks you'd like in one media type, worked out from
 * how far above your own average you rate each genre, person and decade.
 * Lives as a tab inside each library, next to what you've finished and what
 * you mean to get to.
 */
export function Suggestions({ type }: { type: MediaType }) {
  const meta = SECTION_META[type]
  const { toast, refresh, settings } = useApp()
  const [data, setData] = useState<RecResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const [limit, setLimit] = useState(18)
  const [more, setMore] = useState(false)

  /*
   * Asking for more is a bigger slice of the same ranking, not a different
   * one — the order is deterministic, so the titles already on screen keep
   * their places and the new ones land underneath.
   */
  const load = async (force = false, want = limit) => {
    if (want > limit) setMore(true)
    else setLoading(true)
    try {
      const res = await api.get<RecResponse>(`/recommendations?type=${type}&limit=${want}${force ? '&force=1' : ''}`)
      setData(res)
      setLimit(want)
      if (force) setHidden([])
    } catch (err) {
      toast((err as Error).message, 'error')
      if (want === limit) setData(null)
    } finally { setLoading(false); setMore(false) }
  }

  useEffect(() => { setLimit(18); void load(false, 18) }, [type])

  async function act(pick: Pick, what: 'save' | 'log' | 'dismiss') {
    setBusy(pick.fingerprint)
    try {
      if (what === 'save') {
        await api.post('/recommendations/save', { pick })
        toast(`${pick.title} added to ${meta.planned.toLowerCase()}`)
      } else if (what === 'log') {
        await api.post('/recommendations/log', { pick })
        toast(`Logged ${pick.title}`)
      } else {
        await api.post('/recommendations/dismiss', { fingerprint: pick.fingerprint, reason: 'not interested' })
      }
      setHidden((h) => [...h, pick.fingerprint])
      if (what !== 'dismiss') void refresh()
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  const picks = (data?.picks ?? []).filter((p) => !hidden.includes(p.fingerprint))
  const needsTmdb = (type === 'film' || type === 'tv') && !settings.has_tmdb

  return (
    <>
      <div className="u-spread" style={{ margin: '4px 0 14px' }}>
        <span className="u-sm u-mut">
          {loading
            ? 'Working out what you would like…'
            : `${picks.length} from ${data?.candidateCount ?? 0} candidates`
              + `${data?.usingCrowd ? ` · placed by ${(data.crowdSize ?? 0).toLocaleString('en-GB')} of your ratings` : ''}`
              + `${data?.usingTmdb ? ' · TMDB' : ' · keyless sources'}`
              + `${data?.cached ? ' · cached' : ''}`}
        </span>
        <button className="btn btn--sm" onClick={() => load(true, 18)} disabled={loading}>
          <Icon name="refresh" size={14} /> {loading ? 'Thinking…' : 'Refresh'}
        </button>
      </div>

      {needsTmdb && (
        <div className="promo promo--tip">
          <div className="u-col" style={{ gap: 3 }}>
            <strong style={{ fontSize: 14 }}>These get much sharper with a TMDB key</strong>
            <span className="u-sm u-dim">
              Without one, suggestions come from Wikidata — every title by the people you rate highly.
              A free TMDB key adds genre, keyword and “people also liked” matching.
            </span>
          </div>
          <Link className="btn" to="/settings"><Icon name="key" size={14} /> Add key</Link>
        </div>
      )}

      {loading ? (
        <div className="grid grid--wide">{Array.from({ length: 8 }, (_, i) => <PosterSkeleton key={i} aspect={meta.aspect} />)}</div>
      ) : !picks.length ? (
        <Empty
          icon="sparkle"
          title={`No ${meta.label.toLowerCase()} suggestions yet`}
          action={<button className="btn btn--primary" onClick={() => load(true)}>Try again</button>}
        >
          {data?.profileThin
            ? 'Rate a few things first — this works from your own ratings, not a generic popularity chart.'
            : 'Either everything suggested is already in your library, or the metadata sources are having a quiet moment.'}
        </Empty>
      ) : (
        <>
        <div className="recgrid">
          {picks.map((pick) => (
            <article key={pick.fingerprint} className="reccard">
              <div className="reccard__art">
                <PosterArt src={pick.poster_url} title={pick.title} type={pick.type} aspect={meta.aspect} />
              </div>
              <div className="reccard__body">
                <div className="u-col" style={{ gap: 3 }}>
                  <h3 style={{ fontSize: 15.5, letterSpacing: '-0.015em' }}>{pick.title}</h3>
                  <span className="u-xs u-mut">
                    {[pick.year, creatorLine(pick.creators, 2)].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="chiprow">
                  {pick.reasons.map((r, i) => (
                    <span key={i} className="chip chip--why"><Icon name="sparkle" size={11} /> {r}</span>
                  ))}
                </div>
                {pick.genres.length > 0 && (
                  <span className="u-xs u-mut u-trunc">{pick.genres.slice(0, 3).join(' · ')}</span>
                )}
                {pick.overview && <p className="u-xs u-clamp-3" style={{ margin: 0, color: 'var(--ink-3)' }}>{pick.overview}</p>}
                <div className="u-row u-wrap" style={{ gap: 6, marginTop: 'auto' }}>
                  <button className="btn btn--sm btn--primary" disabled={busy === pick.fingerprint} onClick={() => act(pick, 'save')}>
                    <Icon name="inbox" size={13} /> {meta.planned}
                  </button>
                  <button className="btn btn--sm" disabled={busy === pick.fingerprint} onClick={() => act(pick, 'log')}>
                    <Icon name="check" size={13} /> {meta.done}
                  </button>
                  <button className="btn btn--sm btn--ghost" disabled={busy === pick.fingerprint} onClick={() => act(pick, 'dismiss')} title="Never suggest this again">
                    <Icon name="x" size={13} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* There is always more of the ranking below; this just asks for it. */}
        <div style={{ display: 'grid', placeItems: 'center', marginTop: 24 }}>
          <button className="btn" onClick={() => load(false, limit + 18)} disabled={more || loading}>
            {more ? 'Finding more…' : 'Show more suggestions'}
          </button>
        </div>
        </>
      )}
    </>
  )
}
