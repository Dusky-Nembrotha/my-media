import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { PosterArt, PosterSkeleton } from './Poster'
import { Preview } from './Preview'
import type { PreviewTarget } from './Preview'
import { Empty } from './Modal'
import { JustLogged } from './JustLogged'
import type { LoggedThing } from './JustLogged'
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
  const [added, setAdded] = useState<Record<string, true>>({})
  const [logged, setLogged] = useState<LoggedThing | null>(null)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  // Which pick the sheet is showing, so logging from inside it retires the card.
  const [previewOf, setPreviewOf] = useState<string | null>(null)
  const [sort, setSort] = useState<'match' | 'rating' | 'released'>('match')
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
      /*
       * Asking for more must not rearrange what you are already looking at.
       * The ranking is recomputed for the longer list and can shuffle near
       * the margins, which made new picks appear above ones you had just
       * read. Whatever is on screen keeps its place; the rest goes beneath.
       */
      setData((prev) => {
        if (force || !prev?.picks?.length) return res
        const byFingerprint = new Map(res.picks.map((p) => [p.fingerprint, p]))
        const kept = prev.picks.map((p) => byFingerprint.get(p.fingerprint) ?? p)
        const seen = new Set(kept.map((p) => p.fingerprint))
        return { ...res, picks: [...kept, ...res.picks.filter((p) => !seen.has(p.fingerprint))] }
      })
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
        const res = await api.post<{ work_id: number; entry_id: number; consumed_on: string | null }>(
          '/recommendations/log', { pick },
        )
        setLogged({
          workId: res.work_id, entryId: res.entry_id, title: pick.title,
          type: pick.type, consumedOn: res.consumed_on,
        })
      } else {
        await api.post('/recommendations/dismiss', { fingerprint: pick.fingerprint, reason: 'not interested' })
      }
      /*
       * Something you have put on the list stays on screen wearing a flag,
       * the way Hot does it. Pulling the card you just pressed out of the
       * grid reflows everything below and loses your place.
       */
      if (what === 'save') setAdded((a) => ({ ...a, [pick.fingerprint]: true }))
      else setHidden((h) => [...h, pick.fingerprint])
      if (what !== 'dismiss') void refresh()
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  /*
   * The engine's own order is the best match; the others re-read that same
   * list rather than asking for a different one, so nothing is recomputed
   * and the picks stay the picks.
   */
  const ordered = (() => {
    const list = (data?.picks ?? []).filter((p) => !hidden.includes(p.fingerprint))
    if (sort === 'rating') return [...list].sort((a, b) => (b.external_rating ?? 0) - (a.external_rating ?? 0))
    if (sort === 'released') return [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    return list
  })()
  const picks = ordered
  const needsTmdb = (type === 'film' || type === 'tv') && !settings.has_tmdb

  return (
    <>
      {logged && <JustLogged thing={logged} onClose={() => setLogged(null)} />}
      {preview && (
        <Preview
          target={preview}
          onClose={() => { setPreview(null); setPreviewOf(null) }}
          onLogged={(t) => {
            if (previewOf) setHidden((h) => [...h, previewOf])
            setPreview(null); setPreviewOf(null); setLogged(t)
          }}
        />
      )}

      <div className="u-spread" style={{ margin: '4px 0 14px' }}>
        <span className="u-sm u-mut">
          {loading
            ? 'Working out what you would like…'
            : `${picks.length} from ${data?.candidateCount ?? 0} candidates`
              + `${data?.usingCrowd ? ` · placed by ${(data.crowdSize ?? 0).toLocaleString('en-GB')} of your ratings` : ''}`
              + `${data?.usingTmdb ? ' · TMDB' : ' · keyless sources'}`
              + `${data?.cached ? ' · cached' : ''}`}
        </span>
        <div className="u-row u-wrap" style={{ gap: 8 }}>
          <div className="chiprow">
            {([['match', 'Best match'], ['rating', 'Best rated'], ['released', 'Newest']] as const).map(([v, label]) => (
              <button key={v} className={`chip${sort === v ? ' is-on' : ''}`} onClick={() => setSort(v)}>{label}</button>
            ))}
          </div>
          <button className="btn btn--sm" onClick={() => load(true, 18)} disabled={loading}>
            <Icon name="refresh" size={14} /> {loading ? 'Thinking…' : 'Refresh'}
          </button>
        </div>
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
        <div className="grid" style={{ ['--card-w' as string]: meta.aspect === '1 / 1' ? '164px' : '150px' }}>
          {Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={i} aspect={meta.aspect} />)}
        </div>
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
        <div className="grid" style={{ ['--card-w' as string]: meta.aspect === '1 / 1' ? '164px' : '150px' }}>
          {picks.map((pick, i) => (
            <div key={pick.fingerprint} className="poster hotcard">
              {/*
                * A cover, a name and a way in — the same card Hot uses. Why it
                * was picked, what it is about and where to watch it all live in
                * the sheet, because eighteen of those at once is a wall of text
                * nobody reads and the grid could not lay out.
                */}
              <button
                type="button"
                className="poster__open"
                onClick={() => {
                  setPreviewOf(pick.fingerprint)
                  setPreview({
                    type: pick.type,
                    title: pick.title,
                    year: pick.year,
                    creator: pick.creators?.[0]?.name ?? null,
                    reasons: pick.reasons,
                  })
                }}
                title={`What is ${pick.title}?`}
              >
                <span className="hotrank u-tnum">{i + 1}</span>
                {pick.external_rating != null && (
                  <span
                    className="recscore u-tnum"
                    title={`Rated ${pick.external_rating.toFixed(1)} out of 10${pick.provider ? ` by ${pick.provider}` : ''}`
                      + (pick.predicted != null ? ` · we think you would give it ${pick.predicted.toFixed(1)}` : '')}
                  >
                    <Icon name="star" size={10} strokeWidth={0} />
                    {pick.external_rating.toFixed(1)}
                  </span>
                )}
                <PosterArt src={pick.poster_url} title={pick.title} type={pick.type} aspect={meta.aspect} />
              </button>

              <div className="poster__meta">
                <div className="poster__title">{pick.title}</div>
                <div className="poster__sub u-trunc">
                  {[pick.year, creatorLine(pick.creators, 1)].filter(Boolean).join(' \u00b7 ')}
                </div>
              </div>

              {added[pick.fingerprint] ? (
                <span className="hotflag">On your list</span>
              ) : (
                <div className="recactions">
                  <button className="btn btn--sm" disabled={busy === pick.fingerprint} onClick={() => act(pick, 'save')}>
                    <Icon name="plus" size={13} /> {meta.planned}
                  </button>
                  <button
                    className="btn btn--sm btn--ghost"
                    disabled={busy === pick.fingerprint}
                    onClick={() => act(pick, 'dismiss')}
                    title="Never suggest this again"
                    aria-label={`Never suggest ${pick.title} again`}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              )}
            </div>
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
