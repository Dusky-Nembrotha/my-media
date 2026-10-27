import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PosterArt, PosterSkeleton } from '../components/Poster'
import { Empty } from '../components/Modal'
import { api, qs } from '../lib/api'
import { artworkUrl } from '../lib/img'
import { useApp } from '../lib/store'
import { SECTION_META, TYPE_ORDER, creatorLine, fmtDate } from '../lib/format'
import type { MediaType, ProviderHit, WorkCard } from '../lib/types'

interface SeriesInfo { title: string; year: number | null; series: string | null; ordinal: number | null }

/**
 * Full results for a search, rather than the handful the quick palette shows.
 *
 * This is the page for "everything by this author" — the whole list, in the
 * order it was published, with each one addable on the spot. Searching a
 * person's name and being shown six things and a dead end was the problem it
 * exists to solve.
 */
export function FindPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const type = (params.get('type') as MediaType | null) ?? null
  const { toast, refresh } = useApp()

  const [local, setLocal] = useState<WorkCard[]>([])
  const [remote, setRemote] = useState<ProviderHit[]>([])
  const [loading, setLoading] = useState(false)
  const [series, setSeries] = useState<SeriesInfo[]>([])
  const [added, setAdded] = useState<Record<string, 'done' | 'planned'>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [order, setOrder] = useState<'relevance' | 'released'>('relevance')

  useEffect(() => {
    if (!q.trim()) return
    let live = true
    setLoading(true)
    setAdded({})
    void (async () => {
      try {
        const res = await api.get<{ local: WorkCard[]; remote: ProviderHit[] }>(
          `/search${qs({ q, type, limit: 48 })}`,
        )
        if (!live) return
        setLocal(res.local)
        setRemote(res.remote)
      } catch (err) {
        if (live) toast((err as Error).message, 'error')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [q, type])

  // Series names come from a slower source and simply do not arrive for some
  // authors, so they are fetched separately and shown if and when they turn up.
  useEffect(() => {
    setSeries([])
    if (!q.trim() || (type !== 'book' && type !== 'audiobook')) return
    let live = true
    void api.get<{ works: SeriesInfo[] }>(`/creator/series${qs({ name: q })}`)
      .then((res) => { if (live) setSeries(res.works || []) })
      .catch(() => { /* a bonus, not a requirement */ })
    return () => { live = false }
  }, [q, type])

  const seriesFor = useMemo(() => {
    const map = new Map<string, SeriesInfo>()
    for (const w of series) {
      const key = w.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      map.set(key, w)
      // "Mistborn: The Final Empire" should also match a plain "The Final Empire".
      const tail = key.includes(' ') ? key.split(/\s*:\s*/).pop()!.trim() : key
      if (tail && !map.has(tail)) map.set(tail, w)
    }
    return (title: string) => map.get(title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()) ?? null
  }, [series])

  async function add(hit: ProviderHit, mode: 'done' | 'planned') {
    const key = `${hit.title}|${hit.year}`
    setBusy(key)
    try {
      if (mode === 'planned') {
        await api.post('/recs', {
          type: hit.type, title: hit.title, year: hit.year,
          creators: hit.creators, poster_url: hit.poster_url,
        })
      } else {
        await api.post('/recommendations/log', {
          pick: {
            type: hit.type, title: hit.title, year: hit.year,
            creators: hit.creators, poster_url: hit.poster_url,
          },
        })
      }
      setAdded((a) => ({ ...a, [key]: mode }))
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setBusy(null) }
  }

  const sorted = useMemo(() => {
    if (order === 'relevance') return remote
    // Oldest first: for an author's back catalogue that is reading order.
    return [...remote].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))
  }, [remote, order])

  const meta = type ? SECTION_META[type] : null

  if (!q.trim()) {
    return <div className="page"><Empty icon="search" title="Nothing to search for">Type something into the search box.</Empty></div>
  }

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <h2>{q}</h2>
          <p>
            {loading ? 'Searching…' : `${local.length + remote.length} results`}
            {meta ? ` in ${meta.label.toLowerCase()}` : ' across everything'}
          </p>
        </div>
        <div className="chiprow">
          <button className={`chip${order === 'relevance' ? ' is-on' : ''}`} onClick={() => setOrder('relevance')}>
            Best match
          </button>
          <button className={`chip${order === 'released' ? ' is-on' : ''}`} onClick={() => setOrder('released')}>
            By release date
          </button>
        </div>
      </div>

      {/* Narrow to one library, or widen to all of them. */}
      <div className="chiprow" style={{ marginBottom: 16, overflowX: 'auto', flexWrap: 'nowrap' }}>
        <button
          className={`chip${!type ? ' is-on' : ''}`}
          onClick={() => setParams({ q }, { replace: true })}
        >
          Everything
        </button>
        {TYPE_ORDER.slice(0, 6).map((t) => (
          <button
            key={t}
            className={`chip${type === t ? ' is-on' : ''}`}
            onClick={() => setParams({ q, type: t }, { replace: true })}
          >
            {SECTION_META[t].label}
          </button>
        ))}
      </div>

      {local.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="u-caps" style={{ marginBottom: 10 }}>Already in your library</div>
          <div className="card" style={{ padding: 6 }}>
            {local.map((w) => (
              <Link key={w.id} to={`/work/${w.id}`} className="listrow">
                {w.poster_url
                  ? <img className="listrow__thumb" src={artworkUrl(w.poster_url)} alt="" loading="lazy" />
                  : <span className="listrow__thumb" />}
                <span className="u-col u-grow" style={{ gap: 3, minWidth: 0 }}>
                  <span className="u-trunc" style={{ fontSize: 14, fontWeight: 560 }}>{w.title}</span>
                  <span className="u-xs u-mut u-trunc">
                    {[SECTION_META[w.type].singular, w.year, creatorLine(w.creators, 1)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="listrow__right u-xs u-mut">{fmtDate(w.last_on) || ''}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="u-caps" style={{ marginBottom: 10 }}>
        {local.length > 0 ? 'Not in your library yet' : 'Results'}
      </div>

      {loading && !remote.length ? (
        <div className="grid">{Array.from({ length: 8 }, (_, i) => <PosterSkeleton key={i} />)}</div>
      ) : !remote.length ? (
        <Empty icon="search" title={`Nothing else found for “${q}”`}>
          Try a different spelling, or widen the search to everything.
        </Empty>
      ) : (
        <div className="u-col" style={{ gap: 8 }}>
          {sorted.map((hit) => {
            const key = `${hit.title}|${hit.year}`
            const info = seriesFor(hit.title)
            const state = added[key]
            const m = SECTION_META[hit.type]
            return (
              <div key={key} className="findrow">
                <span className="findrow__art" style={{ aspectRatio: m.aspect }}>
                  <PosterArt src={hit.poster_url} title={hit.title} type={hit.type} aspect={m.aspect} />
                </span>
                <span className="u-col u-grow" style={{ gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 560 }}>{hit.title}</span>
                  <span className="u-xs u-mut u-trunc">
                    {[m.singular, hit.year, creatorLine(hit.creators, 1)].filter(Boolean).join(' · ')}
                  </span>
                  {info?.series && (
                    <span className="u-xs" style={{ color: 'var(--accent)' }}>
                      {info.series}{info.ordinal ? ` · book ${info.ordinal}` : ''}
                    </span>
                  )}
                </span>
                {state ? (
                  <span className="u-xs u-mut">{state === 'done' ? m.done : m.planned}</span>
                ) : (
                  <span className="u-row" style={{ gap: 6 }}>
                    <button className="btn btn--sm" disabled={busy === key} onClick={() => add(hit, 'planned')}>
                      {m.planned}
                    </button>
                    <button className="btn btn--sm btn--primary" disabled={busy === key} onClick={() => add(hit, 'done')}>
                      <Icon name="check" size={13} /> {m.verb}
                    </button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
