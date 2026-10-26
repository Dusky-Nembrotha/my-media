import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Empty } from '../components/Modal'
import { PosterArt } from '../components/Poster'
import { api } from '../lib/api'
import { useApp, useFetch } from '../lib/store'
import { SECTION_META, creatorLine, fmtDate, relDate } from '../lib/format'
import type { MediaType, Rec } from '../lib/types'

/** The "someone told me to watch this" inbox. */
export function InboxPage() {
  const { toast, refresh, openLog } = useApp()
  const [status, setStatus] = useState<'open' | 'done' | 'dismissed' | 'all'>('open')
  const { data, loading, reload } = useFetch<{ recs: Rec[]; counts: Record<string, number> }>(`/recs?status=${status}`, [status])

  // Imported watchlists arrive as bare titles; fetch their artwork in the
  // background and refresh when the queue drains.
  useEffect(() => {
    const missing = (data?.recs ?? []).some((r) => r.type && r.poster_url == null)
    if (!missing) return
    let stop = false
    let timer: number | undefined
    const run = async () => {
      try {
        await api.post('/enrich/recs')
        const poll = async () => {
          if (stop) return
          const s = await api.get<{ recsPending: number }>('/enrich/status')
          if (s.recsPending > 0) { timer = window.setTimeout(poll, 2500); return }
          reload()
        }
        timer = window.setTimeout(poll, 2500)
      } catch { /* artwork is a nicety */ }
    }
    void run()
    return () => { stop = true; if (timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.recs?.length])

  async function update(rec: Rec, patch: Partial<Rec>) {
    try {
      await api.patch(`/recs/${rec.id}`, patch)
      reload()
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
  }

  async function logIt(rec: Rec) {
    try {
      await api.post('/recommendations/log', {
        pick: { type: rec.type || 'film', title: rec.title, year: rec.year, creators: rec.creators, poster_url: rec.poster_url },
        rec_id: rec.id,
      })
      toast(`Logged ${rec.title}`)
      reload()
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
  }

  async function remove(rec: Rec) {
    try {
      await api.del(`/recs/${rec.id}`)
      reload()
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
  }

  const recs = data?.recs ?? []
  const counts = data?.counts ?? {}

  return (
    <div className="page">
      <div className="filterbar" style={{ marginTop: 0 }}>
        <div className="chiprow u-grow scrollrow">
          {([['open', 'To check out'], ['done', 'Consumed'], ['dismissed', 'Not for me'], ['all', 'Everything']] as const).map(([v, l]) => (
            <button key={v} className={`chip${status === v ? ' is-on' : ''}`} onClick={() => setStatus(v)}>
              {l}{counts[v] ? ` · ${counts[v]}` : ''}
            </button>
          ))}
        </div>
        <button className="btn btn--primary filterbar__action" onClick={() => openLog({ kind: 'blank', mode: 'want' })}>
          <Icon name="plus" size={15} /> <span className="filterbar__actionlabel">Add a recommendation</span>
        </button>
      </div>

      {loading && !data ? (
        <div className="u-col" style={{ gap: 10 }}>{Array.from({ length: 5 }, (_, i) => <div key={i} className="skel" style={{ height: 92 }} />)}</div>
      ) : !recs.length ? (
        <Empty
          icon="inbox"
          title={status === 'open' ? 'Nothing waiting' : 'Nothing here'}
          action={<button className="btn btn--primary" onClick={() => openLog({ kind: 'blank', mode: 'want' })}><Icon name="plus" size={15} /> Add one</button>}
        >
          When someone tells you about a film, a book or an album, put it here with their name on it —
          watchlists imported from Letterboxd, Goodreads and Spotify land here too.
        </Empty>
      ) : (
        <div className="u-col" style={{ gap: 10 }}>
          {recs.map((rec) => (
            <article key={rec.id} className={`reccard reccard--row${rec.priority === 2 ? ' is-priority' : ''}`}>
              <div style={{ width: 66, flex: '0 0 auto' }}>
                <PosterArt
                  src={rec.poster_url}
                  title={rec.title}
                  type={(rec.type || 'film') as MediaType}
                  aspect={rec.type ? SECTION_META[rec.type].aspect : '2 / 3'}
                />
              </div>
              <div className="u-col u-grow" style={{ gap: 5, minWidth: 0 }}>
                <div className="u-row u-wrap" style={{ gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{rec.title}</strong>
                  {rec.year && <span className="u-xs u-mut u-tnum">{rec.year}</span>}
                  {rec.type && <span className="pill">{SECTION_META[rec.type].singular}</span>}
                  {rec.priority === 2 && <span className="pill pill--accent">Soon</span>}
                  {rec.origin === 'engine' && <span className="pill"><Icon name="sparkle" size={10} /> engine</span>}
                </div>
                <span className="u-xs u-mut">
                  {[creatorLine(rec.creators, 2), rec.recommender ? `via ${rec.recommender}` : null, `added ${relDate(rec.added_at?.slice(0, 10))}`]
                    .filter(Boolean).join(' · ')}
                </span>
                {rec.note && <p className="u-sm" style={{ margin: 0, color: 'var(--ink-2)' }}>{rec.note}</p>}
                {rec.source_url && (
                  <a className="u-xs linkish u-trunc" href={rec.source_url} target="_blank" rel="noreferrer">
                    {rec.source_url} <Icon name="external" size={11} />
                  </a>
                )}
                {rec.status !== 'open' && (
                  <span className="u-xs u-mut">
                    {rec.status === 'done' ? 'Consumed' : 'Dismissed'}{rec.acted_at ? ` ${fmtDate(rec.acted_at.slice(0, 10))}` : ''}
                  </span>
                )}
              </div>
              <div className="reccard__actions">
                {rec.status === 'open' && (
                  <>
                    <button className="btn btn--sm btn--primary" onClick={() => logIt(rec)}><Icon name="check" size={13} /> Log it</button>
                    <button className="btn btn--sm" onClick={() => update(rec, { priority: rec.priority === 2 ? 1 : 2 })}>
                      <Icon name="star" size={13} /> {rec.priority === 2 ? 'Normal' : 'Priority'}
                    </button>
                    <button className="btn btn--sm btn--ghost" onClick={() => update(rec, { status: 'dismissed' })}>Not for me</button>
                  </>
                )}
                {rec.status !== 'open' && (
                  <>
                    <button className="btn btn--sm" onClick={() => update(rec, { status: 'open' })}>Reopen</button>
                    <button className="btn btn--sm btn--ghost btn--danger" onClick={() => remove(rec)}><Icon name="trash" size={13} /></button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

    </div>
  )
}
