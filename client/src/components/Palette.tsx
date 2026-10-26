import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { api, qs } from '../lib/api'
import { useApp } from '../lib/store'
import { SECTION_META, TYPE_ORDER, creatorLine } from '../lib/format'
import type { ProviderHit, WorkCard } from '../lib/types'

type Action = { id: string; label: string; hint?: string; icon: string; run: () => void }

/** ⌘K: jump anywhere, find anything, log anything. */
export function Palette() {
  const { paletteOpen, setPaletteOpen, openLog } = useApp()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [local, setLocal] = useState<WorkCard[]>([])
  const [remote, setRemote] = useState<ProviderHit[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  useEffect(() => {
    if (paletteOpen) { setQ(''); setLocal([]); setRemote([]); setActive(0); setTimeout(() => inputRef.current?.focus(), 30) }
  }, [paletteOpen])

  useEffect(() => {
    if (!paletteOpen) return
    const term = q.trim()
    if (term.length < 2) { setLocal([]); setRemote([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ local: WorkCard[]; remote: ProviderHit[] }>(`/search${qs({ q: term })}`)
        setLocal(res.local)
        setRemote(res.remote.slice(0, 6))
      } catch { /* search is best-effort */ }
    }, 280)
    return () => clearTimeout(t)
  }, [q, paletteOpen])

  if (!paletteOpen) return null

  const close = () => setPaletteOpen(false)
  const go = (path: string) => { close(); navigate(path) }

  const navActions: Action[] = [
    { id: 'home', label: 'Home', icon: 'home', run: () => go('/') },
    ...TYPE_ORDER.slice(0, 7).map((t) => ({
      id: t, label: SECTION_META[t].label, icon: SECTION_META[t].icon, run: () => go(SECTION_META[t].path),
    })),
    { id: 'diary', label: 'Diary', icon: 'calendar', run: () => go('/diary') },
    { id: 'recs', label: 'Recommended for you', icon: 'sparkle', run: () => go('/recommended') },
    { id: 'inbox', label: 'Recommendations inbox', icon: 'inbox', run: () => go('/inbox') },
    { id: 'lists', label: 'Lists', icon: 'list', run: () => go('/lists') },
    { id: 'stats', label: 'Stats', icon: 'chart', run: () => go('/stats') },
    { id: 'connections', label: 'Connections', icon: 'key', run: () => go('/connections') },
    { id: 'import', label: 'Import data', icon: 'import', run: () => go('/import') },
    { id: 'settings', label: 'Settings', icon: 'settings', run: () => go('/settings') },
    { id: 'log', label: 'Log something new', hint: 'opens the log dialog', icon: 'plus', run: () => { close(); openLog({ kind: 'blank' }) } },
  ]

  const term = q.trim().toLowerCase()
  const actions = term
    ? navActions.filter((a) => a.label.toLowerCase().includes(term))
    : navActions.slice(0, 9)

  const rows: Array<{ kind: 'action'; a: Action } | { kind: 'work'; w: WorkCard } | { kind: 'hit'; h: ProviderHit }> = [
    ...local.map((w) => ({ kind: 'work' as const, w })),
    ...actions.map((a) => ({ kind: 'action' as const, a })),
    ...remote.map((h) => ({ kind: 'hit' as const, h })),
  ]

  const activate = (i: number) => {
    const row = rows[i]
    if (!row) return
    if (row.kind === 'action') row.a.run()
    else if (row.kind === 'work') go(`/work/${row.w.id}`)
    else { close(); openLog({ kind: 'hit', hit: row.h }) }
  }

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="sheet sheet--palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="sheet__head">
          <Icon name="search" size={17} className="u-mut" />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="Search your library, or anything to log…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
              if (e.key === 'Enter') { e.preventDefault(); activate(active) }
              if (e.key === 'Escape') close()
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette__list">
          {local.length > 0 && <div className="palette__group u-caps">In your library</div>}
          {rows.map((row, i) => {
            const isActive = i === active
            if (row.kind === 'work') {
              return (
                <button key={`w${row.w.id}`} className={`palette__item${isActive ? ' is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => activate(i)}>
                  {row.w.poster_url
                    ? <img className={`palette__thumb${SECTION_META[row.w.type].aspect === '1 / 1' ? ' palette__thumb--sq' : ''}`} src={row.w.poster_url} alt="" />
                    : <span className="palette__thumb" />}
                  <span className="u-grow u-col" style={{ gap: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 560 }}>{row.w.title}</span>
                    <span className="u-xs u-mut u-trunc">
                      {[SECTION_META[row.w.type].singular, row.w.year, creatorLine(row.w.creators, 1)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {row.w.rating != null && <span className="u-xs u-tnum u-dim">{row.w.rating}★</span>}
                </button>
              )
            }
            if (row.kind === 'action') {
              const first = rows.findIndex((r) => r.kind === 'action')
              return (
                <div key={row.a.id}>
                  {i === first && <div className="palette__group u-caps">Go to</div>}
                  <button className={`palette__item${isActive ? ' is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => activate(i)}>
                    <span className="iconbtn" style={{ pointerEvents: 'none', width: 30, height: 30 }}><Icon name={row.a.icon} size={16} /></span>
                    <span className="u-grow" style={{ fontSize: 13.5 }}>{row.a.label}</span>
                    {row.a.hint && <span className="u-xs u-mut">{row.a.hint}</span>}
                  </button>
                </div>
              )
            }
            const first = rows.findIndex((r) => r.kind === 'hit')
            return (
              <div key={`h${i}`}>
                {i === first && <div className="palette__group u-caps">Not in your library yet</div>}
                <button className={`palette__item${isActive ? ' is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => activate(i)}>
                  {row.h.poster_url
                    ? <img className={`palette__thumb${SECTION_META[row.h.type].aspect === '1 / 1' ? ' palette__thumb--sq' : ''}`} src={row.h.poster_url} alt="" />
                    : <span className="palette__thumb" />}
                  <span className="u-grow u-col" style={{ gap: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 560 }}>{row.h.title}</span>
                    <span className="u-xs u-mut u-trunc">
                      {[SECTION_META[row.h.type].singular, row.h.year, creatorLine(row.h.creators, 1)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="pill">Log</span>
                </button>
              </div>
            )
          })}
          {term.length >= 2 && rows.length === 0 && (
            <div style={{ padding: '26px 14px', textAlign: 'center' }} className="u-sm u-mut">
              Nothing found for “{q}”.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
