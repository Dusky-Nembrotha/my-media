import { useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { api } from '../lib/api'
import { artworkUrl } from '../lib/img'
import { useApp, useFetch } from '../lib/store'

interface Candidate {
  url: string
  source: string
  label?: string
  width?: number
  height?: number
  quality?: string | null
  cached?: string | null
}

/** Pick a better cover from everything the providers hold for a title. */
export function ArtworkPicker({ workId, onClose, onChosen }: {
  workId: number
  onClose: () => void
  onChosen: (poster: string) => void
}) {
  const { toast } = useApp()
  const { data, loading } = useFetch<{ current: string; currentMeta: any; candidates: Candidate[] }>(
    `/works/${workId}/artwork`, [workId],
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [custom, setCustom] = useState('')

  async function choose(url: string) {
    setBusy(url)
    try {
      const res = await api.post<{ poster_url: string; width: number; height: number }>(
        `/works/${workId}/artwork`, { url },
      )
      toast(`Cover updated${res.width ? ` — ${res.width}×${res.height}` : ''}`)
      onChosen(res.poster_url)
      onClose()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally { setBusy(null) }
  }

  const current = data?.currentMeta

  return (
    <Modal title="Choose a cover" onClose={onClose} wide>
      <div className="sheet__body">
        {current?.width ? (
          <p className="u-sm u-mut" style={{ margin: 0 }}>
            The one in use is {current.width}×{current.height}
            {current.quality === 'poor' || current.quality === 'low'
              ? ' — small enough to look soft on a card.'
              : '.'}
          </p>
        ) : null}

        {loading ? (
          <div className="grid grid--tight">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skel" style={{ aspectRatio: '2 / 3', borderRadius: 'var(--r-sm)' }} />
            ))}
          </div>
        ) : !data?.candidates?.length ? (
          <p className="u-sm u-mut" style={{ margin: 0 }}>
            No alternatives found. You can paste the address of an image below.
          </p>
        ) : (
          <div className="grid grid--tight">
            {data.candidates.map((c) => (
              <button
                key={c.url}
                className={`artchoice${busy === c.url ? ' is-busy' : ''}`}
                onClick={() => choose(c.url)}
                disabled={Boolean(busy)}
                title={`${c.source}${c.width ? ` · ${c.width}×${c.height}` : ''}`}
              >
                <img src={artworkUrl(c.cached || c.url)} alt="" loading="lazy" />
                <span className="artchoice__meta">
                  {c.width ? `${c.width}×${c.height}` : c.source}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="field">
          <label htmlFor="art-url">Or paste an image address</label>
          <div className="u-row" style={{ gap: 8 }}>
            <input
              id="art-url"
              className="input"
              placeholder="https://…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button className="btn btn--primary" disabled={!custom.trim() || Boolean(busy)} onClick={() => choose(custom.trim())}>
              Use it
            </button>
          </div>
          <span className="field__hint">It is copied here, so the original can disappear without breaking anything.</span>
        </div>
      </div>
    </Modal>
  )
}

/** The covers that came out too small to look right. */
export function PoorArtworkList() {
  const { data, loading, reload } = useFetch<{ works: any[] }>('/artwork/poor')
  const [picking, setPicking] = useState<number | null>(null)
  const [upgrading, setUpgrading] = useState(false)
  const { toast } = useApp()

  async function upgradeAll() {
    setUpgrading(true)
    try {
      const res = await api.post<{ queued: number }>('/artwork/upgrade')
      toast(`Looking for better covers for ${res.queued} titles — this takes a minute`, 'info')
      setTimeout(reload, 20000)
    } catch (err) { toast((err as Error).message, 'error') } finally { setUpgrading(false) }
  }

  if (loading) return <div className="skel" style={{ height: 80 }} />
  const works = data?.works ?? []
  if (!works.length) {
    return <p className="u-sm u-mut" style={{ margin: 0 }}>Every cover is a decent size. Nothing to fix.</p>
  }

  return (
    <>
      <div className="u-spread" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        <p className="u-sm u-mut" style={{ margin: 0, maxWidth: '44ch' }}>
          {works.length} {works.length === 1 ? 'cover is' : 'covers are'} small enough to look soft.
          Fetch the best available for all of them, or choose one yourself.
        </p>
        <button className="btn btn--sm btn--primary" onClick={upgradeAll} disabled={upgrading}>
          <Icon name="refresh" size={13} /> {upgrading ? 'Starting…' : 'Upgrade all'}
        </button>
      </div>
      <div className="u-col" style={{ gap: 6 }}>
        {works.map((w) => (
          <div key={w.id} className="actrow">
            {w.poster_url
              ? <img className="actrow__thumb" src={artworkUrl(w.poster_url)} alt="" loading="lazy" />
              : <span className="actrow__thumb" />}
            <span className="u-col u-grow" style={{ gap: 2, minWidth: 0 }}>
              <span className="u-trunc" style={{ fontSize: 13.5, fontWeight: 560 }}>{w.title}</span>
              <span className="u-xs u-mut">
                {w.w ? `${w.w}×${w.h}` : 'no cover'}{w.year ? ` · ${w.year}` : ''}
              </span>
            </span>
            <button className="btn btn--sm" onClick={() => setPicking(w.id)}>
              <Icon name="pencil" size={13} /> Change
            </button>
          </div>
        ))}
      </div>
      {picking != null && (
        <ArtworkPicker workId={picking} onClose={() => setPicking(null)} onChosen={() => reload()} />
      )}
    </>
  )
}
