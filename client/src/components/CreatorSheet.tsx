import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { PosterArt } from './Poster'
import { api, qs } from '../lib/api'
import { useApp, useFetch } from '../lib/store'
import { SECTION_META } from '../lib/format'
import type { MediaType } from '../lib/types'

interface CreatorWork {
  type: MediaType
  title: string
  year: number | null
  poster_url: string | null
  creators: { role?: string; name: string }[]
  series: string | null
  ordinal: number | null
  work_id: number | null
  inLibrary: boolean
  onList: boolean
}

interface Profile {
  name: string
  bio: string | null
  image: string | null
  url: string | null
  counts: { total: number; yours: number }
  series: { name: string; items: CreatorWork[] }[]
  standalone: CreatorWork[]
}

/**
 * Everything one person made, in one place.
 *
 * Tapping an author or a director opens this: who they are, then their whole
 * output arranged the way you would read or watch it — series in order,
 * standalones after — with what you already have marked. Adding six books of
 * a series one at a time through search is miserable; here it is six taps.
 */
export function CreatorSheet({ name, type, onClose }: {
  name: string
  type: MediaType
  onClose: () => void
}) {
  const meta = SECTION_META[type]
  const { toast, refresh } = useApp()
  const { data, loading } = useFetch<Profile>(`/creator/profile${qs({ name, type })}`, [name, type])
  const [added, setAdded] = useState<Record<string, 'done' | 'planned'>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [openBio, setOpenBio] = useState(false)

  async function add(work: CreatorWork, mode: 'done' | 'planned') {
    setBusy(work.title)
    try {
      if (mode === 'planned') {
        await api.post('/recs', {
          type: work.type, title: work.title, year: work.year,
          creators: work.creators, poster_url: work.poster_url,
        })
      } else {
        await api.post('/recommendations/log', {
          pick: {
            type: work.type, title: work.title, year: work.year,
            creators: work.creators, poster_url: work.poster_url,
          },
        })
      }
      setAdded((a) => ({ ...a, [work.title]: mode }))
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setBusy(null) }
  }

  const row = (work: CreatorWork) => {
    const state = added[work.title]
    return (
      <div key={work.title} className="findrow">
        <span className="findrow__art" style={{ aspectRatio: meta.aspect }}>
          <PosterArt src={work.poster_url} title={work.title} type={work.type} aspect={meta.aspect} />
        </span>
        <span className="u-col u-grow" style={{ gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 560 }}>
            {work.ordinal ? <span className="u-mut u-tnum">{work.ordinal}. </span> : null}
            {work.title}
          </span>
          <span className="u-xs u-mut">{work.year ?? ''}</span>
        </span>
        {work.work_id ? (
          <Link className="btn btn--sm btn--ghost" to={`/work/${work.work_id}`} onClick={onClose}>
            Yours <Icon name="chevronRight" size={12} />
          </Link>
        ) : state || work.onList ? (
          <span className="u-xs u-mut">{state === 'done' ? meta.done : meta.planned}</span>
        ) : (
          <span className="u-row" style={{ gap: 6 }}>
            <button className="btn btn--sm" disabled={busy === work.title} onClick={() => add(work, 'planned')}>
              {meta.planned}
            </button>
            <button className="btn btn--sm btn--primary" disabled={busy === work.title} onClick={() => add(work, 'done')}>
              <Icon name="check" size={13} /> {meta.verb}
            </button>
          </span>
        )}
      </div>
    )
  }

  return (
    <Modal title={data?.name || name} onClose={onClose} wide>
      <div className="sheet__body">
        {loading ? (
          <p className="u-sm u-mut" style={{ margin: 0 }}>Looking them up…</p>
        ) : !data ? (
          <p className="u-sm u-mut" style={{ margin: 0 }}>Nothing found for {name}.</p>
        ) : (
          <>
            <div className="u-row" style={{ gap: 14, alignItems: 'flex-start' }}>
              {data.image && (
                <img className="creatorface" src={data.image} alt="" loading="lazy" />
              )}
              <div className="u-col u-grow" style={{ gap: 6, minWidth: 0 }}>
                <span className="u-xs u-mut">
                  {data.counts.total} {meta.label.toLowerCase()} · {data.counts.yours} already yours
                </span>
                {data.bio && (
                  <>
                    <p className={`u-sm${openBio ? '' : ' u-clamp-3'}`} style={{ margin: 0, color: 'var(--ink-2)' }}>
                      {data.bio}
                    </p>
                    {data.bio.length > 180 && (
                      <button className="linkish u-xs" onClick={() => setOpenBio((v) => !v)}>
                        {openBio ? 'Less' : 'More'}
                      </button>
                    )}
                  </>
                )}
                {data.url && (
                  <a className="u-xs linkish" href={data.url} target="_blank" rel="noreferrer">
                    Wikipedia <Icon name="external" size={11} />
                  </a>
                )}
              </div>
            </div>

            {data.series.map((s) => (
              <section key={s.name} style={{ marginTop: 18 }}>
                <div className="u-caps" style={{ marginBottom: 8 }}>{s.name}</div>
                <div className="u-col" style={{ gap: 8 }}>{s.items.map(row)}</div>
              </section>
            ))}

            {data.standalone.length > 0 && (
              <section style={{ marginTop: 18 }}>
                <div className="u-caps" style={{ marginBottom: 8 }}>
                  {data.series.length ? 'Everything else' : meta.label}
                </div>
                <div className="u-col" style={{ gap: 8 }}>{data.standalone.map(row)}</div>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
