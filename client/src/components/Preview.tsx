import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { PosterArt } from './Poster'
import { api, qs } from '../lib/api'
import { useApp, useFetch } from '../lib/store'
import { SECTION_META, creatorLine, fmtDate, fmtRuntime } from '../lib/format'
import type { MediaType } from '../lib/types'

export interface PreviewTarget {
  type: MediaType
  title: string
  year?: number | null
  creator?: string | null
  /** A date to inherit when adding — the rest of a series read in one run. */
  consumedOn?: string | null
}

interface PreviewBody {
  type: MediaType
  title: string
  year: number | null
  creators: { role?: string; name: string }[]
  cast: string[]
  genres: string[]
  overview: string | null
  poster_url: string | null
  runtime: number | null
  pages: number | null
  language: string | null
  external_rating: number | null
  release_date: string | null
  provider: string | null
}

/**
 * A look at something you do not own.
 *
 * Covers shown in a series row, a chart or a suggestion were previously a
 * dead end — a title and a picture and no way to find out what it was before
 * deciding. This fetches the same details a work page would show, without
 * adding anything to the library.
 */
export function Preview({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  const meta = SECTION_META[target.type]
  const navigate = useNavigate()
  const { toast, refresh } = useApp()
  const [busy, setBusy] = useState(false)

  const { data, loading } = useFetch<{ found: boolean; work_id: number | null; preview: PreviewBody }>(
    `/preview${qs({ type: target.type, title: target.title, creator: target.creator ?? null, year: target.year ?? null })}`,
    [target.type, target.title, target.creator, target.year],
  )

  const p = data?.preview

  async function add(mode: 'done' | 'planned') {
    setBusy(true)
    try {
      if (mode === 'planned') {
        await api.post('/recs', {
          type: target.type,
          title: p?.title ?? target.title,
          year: p?.year ?? target.year ?? null,
          creators: p?.creators ?? [],
          poster_url: p?.poster_url ?? null,
        })
        toast(`${p?.title ?? target.title} added to ${meta.planned.toLowerCase()}`)
      } else {
        const res = await api.post<{ work: { id: number; title: string } }>('/log', {
          work: {
            type: target.type,
            title: p?.title ?? target.title,
            year: p?.year ?? target.year ?? null,
            creators: p?.creators ?? [],
            poster_url: p?.poster_url ?? null,
            overview: p?.overview ?? null,
            genres: p?.genres ?? [],
            pages: p?.pages ?? null,
          },
          consumed_on: target.consumedOn ?? undefined,
          status: 'completed',
          format: target.type === 'book' ? 'book' : null,
        })
        toast(`${meta.verb} ${res.work.title}`)
      }
      void refresh()
      onClose()
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setBusy(false) }
  }

  const facts = [
    p?.year ? String(p.year) : null,
    p?.runtime ? fmtRuntime(p.runtime) : null,
    p?.pages ? `${p.pages} pages` : null,
    p?.external_rating ? `${p.external_rating.toFixed(1)} externally` : null,
  ].filter(Boolean)

  return (
    <Modal
      title={p?.title ?? target.title}
      onClose={onClose}
      footer={
        data?.work_id ? (
          <>
            <button className="btn btn--ghost" onClick={onClose}>Close</button>
            <button className="btn btn--primary" onClick={() => { onClose(); navigate(`/work/${data.work_id}`) }}>
              Open in your library
            </button>
          </>
        ) : (
          <>
            <button className="btn btn--ghost" onClick={onClose}>Close</button>
            <button className="btn" disabled={busy || loading} onClick={() => add('planned')}>
              {meta.planned}
            </button>
            <button className="btn btn--primary" disabled={busy || loading} onClick={() => add('done')}>
              <Icon name="check" size={14} /> {meta.verb}
              {target.consumedOn ? ` · ${fmtDate(target.consumedOn)}` : ''}
            </button>
          </>
        )
      }
    >
      <div className="sheet__body">
        {loading ? (
          <div className="u-row" style={{ gap: 14 }}>
            <div className="skel" style={{ width: 96, height: 140, flex: '0 0 auto' }} />
            <div className="u-col u-grow" style={{ gap: 8 }}>
              <div className="skel" style={{ height: 14, width: '70%' }} />
              <div className="skel" style={{ height: 11, width: '45%' }} />
              <div className="skel" style={{ height: 60 }} />
            </div>
          </div>
        ) : (
          <>
            <div className="u-row" style={{ gap: 14, alignItems: 'flex-start' }}>
              <span style={{ width: 96, flex: '0 0 auto' }}>
                <PosterArt src={p?.poster_url ?? null} title={p?.title ?? target.title} type={target.type} aspect={meta.aspect} />
              </span>
              <div className="u-col u-grow" style={{ gap: 6, minWidth: 0 }}>
                <span className="u-row u-wrap" style={{ gap: 8 }}>
                  <span className="pill" style={{ color: meta.hue }}>{meta.singular}</span>
                  {data?.work_id && <span className="pill pill--good">Already yours</span>}
                </span>
                {creatorLine(p?.creators ?? [], 3) && (
                  <span className="u-sm u-dim">{creatorLine(p?.creators ?? [], 3)}</span>
                )}
                {facts.length > 0 && <span className="u-xs u-mut">{facts.join(' · ')}</span>}
                {p?.genres?.length ? (
                  <span className="chiprow">
                    {p.genres.slice(0, 4).map((g) => <span key={g} className="chip">{g}</span>)}
                  </span>
                ) : null}
              </div>
            </div>

            {p?.overview ? (
              <p className="u-sm" style={{ margin: 0, lineHeight: 1.6, color: 'var(--ink-2)' }}>{p.overview}</p>
            ) : (
              <p className="u-sm u-mut" style={{ margin: 0 }}>
                No synopsis found for this one.
              </p>
            )}

            {p?.cast?.length ? (
              <p className="u-xs u-mut" style={{ margin: 0 }}>With {p.cast.slice(0, 5).join(', ')}</p>
            ) : null}

            {p?.provider && (
              <p className="u-xs u-mut" style={{ margin: 0, textTransform: 'capitalize' }}>
                Details from {p.provider}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
