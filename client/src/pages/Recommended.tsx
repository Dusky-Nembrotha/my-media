import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PosterArt, PosterSkeleton } from '../components/Poster'
import { Empty } from '../components/Modal'
import { api } from '../lib/api'
import { useApp, useFetch } from '../lib/store'
import { SECTION_META, TYPE_ORDER, creatorLine } from '../lib/format'
import type { MediaType, Pick } from '../lib/types'

interface RecResponse {
  type: MediaType
  picks: Pick[]
  cached?: boolean
  profileThin?: boolean
  usingTmdb?: boolean
  candidateCount?: number
  computed_at?: string
}

export function RecommendedPage() {
  const { sections, toast, refresh, settings } = useApp()
  const live = sections.filter((s) => s.works > 0).map((s) => s.type as MediaType)
  const order = TYPE_ORDER.filter((t) => live.includes(t))
  const [type, setType] = useState<MediaType>(order[0] || 'film')
  const [data, setData] = useState<RecResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [hidden, setHidden] = useState<string[]>([])

  useEffect(() => { if (order.length && !order.includes(type)) setType(order[0]) }, [order, type])

  const load = async (t: MediaType, force = false) => {
    setLoading(true)
    try {
      const res = await api.get<RecResponse>(`/recommendations?type=${t}&limit=18${force ? '&force=1' : ''}`)
      setData(res)
      setHidden([])
    } catch (err) {
      toast((err as Error).message, 'error')
      setData(null)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load(type) }, [type])

  const profile = useFetch<any>('/profile')

  async function save(pick: Pick) {
    setBusy(pick.fingerprint)
    try {
      await api.post('/recommendations/save', { pick })
      toast(`${pick.title} added to your list`)
      setHidden((h) => [...h, pick.fingerprint])
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  async function logIt(pick: Pick) {
    setBusy(pick.fingerprint)
    try {
      await api.post('/recommendations/log', { pick })
      toast(`Logged ${pick.title}`)
      setHidden((h) => [...h, pick.fingerprint])
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  async function dismiss(pick: Pick) {
    setBusy(pick.fingerprint)
    try {
      await api.post('/recommendations/dismiss', { fingerprint: pick.fingerprint, reason: 'not interested' })
      setHidden((h) => [...h, pick.fingerprint])
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  const picks = (data?.picks ?? []).filter((p) => !hidden.includes(p.fingerprint))
  const meta = SECTION_META[type]
  const needsTmdb = (type === 'film' || type === 'tv') && !settings.has_tmdb

  return (
    <div className="page">
      <div className="filterbar" style={{ marginTop: 0 }}>
        <div className="chiprow u-grow scrollrow">
          {order.map((t) => (
            <button key={t} className={`chip${type === t ? ' is-on' : ''}`} onClick={() => setType(t)}>
              {SECTION_META[t].label}
            </button>
          ))}
        </div>
        <button className="btn btn--sm" onClick={() => load(type, true)} disabled={loading}>
          <Icon name="refresh" size={14} /> {loading ? 'Thinking…' : 'Refresh picks'}
        </button>
      </div>

      {needsTmdb && (
        <div className="promo promo--tip">
          <div className="u-col" style={{ gap: 3 }}>
            <strong style={{ fontSize: 14 }}>Film and TV picks get much sharper with a TMDB key</strong>
            <span className="u-sm u-dim">
              Without one, suggestions come from Wikidata — every film by the directors you rate highly.
              A free TMDB key adds genre, keyword and "people also liked" matching.
            </span>
          </div>
          <Link className="btn" to="/settings"><Icon name="key" size={14} /> Add key</Link>
        </div>
      )}

      {profile.data?.counts?.rated != null && profile.data.counts.rated < 8 && (
        <div className="promo promo--tip">
          <div className="u-col" style={{ gap: 3 }}>
            <strong style={{ fontSize: 14 }}>The engine is still getting to know you</strong>
            <span className="u-sm u-dim">
              {profile.data.counts.rated} rated {profile.data.counts.rated === 1 ? 'entry' : 'entries'} so far.
              Rate a dozen or so and these picks sharpen up considerably.
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid--wide">{Array.from({ length: 8 }, (_, i) => <PosterSkeleton key={i} aspect={meta.aspect} />)}</div>
      ) : !picks.length ? (
        <Empty icon="sparkle" title={`No ${meta.label.toLowerCase()} picks yet`}
          action={<button className="btn btn--primary" onClick={() => load(type, true)}>Try again</button>}>
          {data?.profileThin
            ? 'Rate a few things first — the engine works from your own ratings, not a generic popularity chart.'
            : 'Either everything suggested is already in your library, or the metadata sources are having a quiet moment.'}
        </Empty>
      ) : (
        <>
          <div className="reccount u-sm u-mut">
            {picks.length} picks from {data?.candidateCount ?? 0} candidates
            {data?.usingTmdb ? ' · TMDB' : ' · keyless sources'}
            {data?.cached ? ' · cached' : ''}
          </div>
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
                    <button className="btn btn--sm btn--primary" disabled={busy === pick.fingerprint} onClick={() => save(pick)}>
                      <Icon name="inbox" size={13} /> Add to list
                    </button>
                    <button className="btn btn--sm" disabled={busy === pick.fingerprint} onClick={() => logIt(pick)}>
                      <Icon name="check" size={13} /> Seen it
                    </button>
                    <button className="btn btn--sm btn--ghost" disabled={busy === pick.fingerprint} onClick={() => dismiss(pick)} title="Never suggest this again">
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {profile.data?.genres?.length ? (
        <section style={{ marginTop: 40 }}>
          <div className="section-head">
            <div>
              <h2>What the engine thinks you like</h2>
              <p>How far above your own average you rate each thing</p>
            </div>
            <Link className="btn btn--sm btn--ghost" to="/stats">Full stats <Icon name="chevronRight" size={14} /></Link>
          </div>
          <div className="tastegrid">
            <TasteCard title="Genres" items={profile.data.genres} />
            <TasteCard title="People" items={profile.data.creators} />
            {profile.data.decades?.length ? <TasteCard title="Decades" items={profile.data.decades} /> : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function TasteCard({ title, items }: { title: string; items: any[] }) {
  const max = Math.max(...items.map((i) => Math.abs(i.score)), 0.25)
  return (
    <div className="card">
      <div className="u-caps" style={{ marginBottom: 12 }}>{title}</div>
      <div className="u-col" style={{ gap: 10 }}>
        {items.slice(0, 7).map((item) => (
          <div key={item.label + item.role} className="u-col" style={{ gap: 4 }}>
            <div className="u-spread">
              <span className="u-sm u-trunc" style={{ textTransform: 'capitalize' }}>{item.label}</span>
              <span className="u-xs u-mut u-tnum">+{item.score.toFixed(2)}★ · {item.n}</span>
            </div>
            <div className="meter"><div className="meter__fill" style={{ width: `${Math.min(100, (item.score / max) * 100)}%` }} /></div>
            {item.support?.[0] && (
              <span className="u-xs u-mut u-trunc">from {item.support.slice(0, 2).map((s: any) => s.title).join(', ')}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
