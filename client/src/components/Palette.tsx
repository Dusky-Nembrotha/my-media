import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { artworkUrl } from '../lib/img'
import { api, qs } from '../lib/api'
import { useApp } from '../lib/store'
import { useCloseOnBack } from '../lib/useCloseOnBack'
import { SECTION_META, TYPE_ORDER, creatorLine, typeOf } from '../lib/format'
import type { MediaType, ProviderHit, WorkCard } from '../lib/types'

type Action = { id: string; label: string; hint?: string; icon: string; run: () => void }

/** ⌘K: jump anywhere, find anything, log anything. */
export function Palette() {
  const { paletteOpen, setPaletteOpen, openLog } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  /*
   * Searching from inside a library means you want that library. Opening the
   * search on the Books page and being shown a TV series, a film and two
   * albums before a single book is not a search, it is a shrug.
   */
  const here = typeOf(location.pathname)
  const [scope, setScope] = useState<MediaType | 'all'>(here ?? 'all')
  const [q, setQ] = useState('')
  const [local, setLocal] = useState<WorkCard[]>([])
  const [remote, setRemote] = useState<ProviderHit[]>([])
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Replies can arrive out of order; only the newest query may paint.
  const seq = useRef(0)

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
    if (!paletteOpen) return
    setQ(''); setLocal([]); setRemote([]); setActive(0)
    setScope(here ?? 'all')
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [paletteOpen, here])

  useEffect(() => {
    if (!paletteOpen) return
    const term = q.trim()
    if (term.length < 2) { setLocal([]); setRemote([]); setSearching(false); return }

    const mine = ++seq.current
    const t = setTimeout(async () => {
      // Your own library comes straight from the database, so show it at once
      // rather than waiting on the metadata services.
      try {
        const scoped = scope === 'all' ? null : scope
        const quick = await api.get<{ local: WorkCard[] }>(`/search${qs({ q: term, type: scoped, remote: 0 })}`)
        if (seq.current === mine) setLocal(quick.local)
      } catch { /* the remote pass may still succeed */ }

      if (seq.current !== mine) return
      setSearching(true)
      try {
        const res = await api.get<{ local: WorkCard[]; remote: ProviderHit[] }>(
          `/search${qs({ q: term, type: scope === 'all' ? null : scope })}`,
        )
        if (seq.current === mine) { setLocal(res.local); setRemote(res.remote.slice(0, 8)) }
      } catch { /* leave whatever the quick pass found */ } finally {
        if (seq.current === mine) setSearching(false)
      }
    }, 180)
    return () => clearTimeout(t)
  }, [q, paletteOpen, scope])

  // Back dismisses the search rather than leaving the page behind it.
  useCloseOnBack(paletteOpen, () => setPaletteOpen(false))

  if (!paletteOpen) return null

  const close = () => setPaletteOpen(false)
  const go = (path: string) => { close(); navigate(path) }

  const navActions: Action[] = [
    { id: 'home', label: 'Home', icon: 'home', run: () => go('/') },
    ...TYPE_ORDER.slice(0, 7).map((t) => ({
      id: t, label: SECTION_META[t].label, icon: SECTION_META[t].icon, run: () => go(SECTION_META[t].path),
    })),
    { id: 'inbox', label: 'Everything to check out', icon: 'inbox', run: () => go('/inbox') },
    { id: 'stats', label: 'Stats', icon: 'chart', run: () => go('/stats') },
    { id: 'connections', label: 'Connections', icon: 'key', run: () => go('/connections') },
    { id: 'import', label: 'Import data', icon: 'import', run: () => go('/import') },
    { id: 'settings', label: 'Settings', icon: 'settings', run: () => go('/settings') },
    { id: 'log', label: 'Add something new', hint: 'search and add anything', icon: 'plus', run: () => { close(); openLog({ kind: 'blank' }) } },
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
          <button
            className="iconbtn"
            aria-label="See all results"
            title="See all results"
            onClick={() => q.trim() && go(`/find${qs({ q: q.trim(), type: scope === 'all' ? null : scope })}`)}
          >
            <Icon name="search" size={17} />
          </button>
          <input
            ref={inputRef}
            className="palette__input"
            placeholder={scope === 'all'
              ? 'Search your library, or anything to add…'
              : `Search ${SECTION_META[scope].label.toLowerCase()}…`}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
              if (e.key === 'Enter') {
                e.preventDefault()
                // Shift+Enter, or no row highlighted, opens the full results.
                if (e.shiftKey || active < 0) go(`/find${qs({ q: q.trim(), type: scope === 'all' ? null : scope })}`)
                else activate(active)
              }
              if (e.key === 'Escape') close()
            }}
          />
          {searching && <span className="spinner" />}
          <kbd>esc</kbd>
        </div>

        {/* What is being searched, and one tap to widen it. */}
        <div className="palette__scope chiprow">
          {here && (
            <button
              className={`chip${scope === here ? ' is-on' : ''}`}
              onClick={() => setScope(here)}
            >
              <Icon name={SECTION_META[here].icon} size={12} /> {SECTION_META[here].label}
            </button>
          )}
          <button className={`chip${scope === 'all' ? ' is-on' : ''}`} onClick={() => setScope('all')}>
            Everything
          </button>
          {!here && TYPE_ORDER.slice(0, 5).map((t) => (
            <button key={t} className={`chip${scope === t ? ' is-on' : ''}`} onClick={() => setScope(t)}>
              {SECTION_META[t].label}
            </button>
          ))}
        </div>
        <div className="palette__list">
          {local.length > 0 && <div className="palette__group u-caps">In your library</div>}
          {rows.map((row, i) => {
            const isActive = i === active
            if (row.kind === 'work') {
              return (
                <button key={`w${row.w.id}`} className={`palette__item${isActive ? ' is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => activate(i)}>
                  {row.w.poster_url
                    ? <img className={`palette__thumb${SECTION_META[row.w.type].aspect === '1 / 1' ? ' palette__thumb--sq' : ''}`} src={artworkUrl(row.w.poster_url)} alt="" />
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
                    ? <img className={`palette__thumb${SECTION_META[row.h.type].aspect === '1 / 1' ? ' palette__thumb--sq' : ''}`} src={artworkUrl(row.h.poster_url)} alt="" />
                    : <span className="palette__thumb" />}
                  <span className="u-grow u-col" style={{ gap: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 560 }}>{row.h.title}</span>
                    <span className="u-xs u-mut u-trunc">
                      {[SECTION_META[row.h.type].singular, row.h.year, creatorLine(row.h.creators, 1)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="pill">Add</span>
                </button>
              </div>
            )
          })}
          {/*
            * The palette shows a handful; an author has dozens. This is the way
            * through to all of them, with everything addable on the spot.
            */}
          {term.length >= 2 && (
            <button
              className="palette__item palette__all"
              onClick={() => go(`/find${qs({ q: term, type: scope === 'all' ? null : scope })}`)}
            >
              <span className="iconbtn" style={{ pointerEvents: 'none', width: 30, height: 30 }}><Icon name="search" size={16} /></span>
              <span className="u-grow" style={{ fontSize: 13.5 }}>
                See all results for “{term}”
              </span>
              <Icon name="chevronRight" size={15} className="u-mut" />
            </button>
          )}

          {term.length >= 2 && rows.length === 0 && (
            <div style={{ padding: '26px 14px', textAlign: 'center' }} className="u-sm u-mut">
              {searching ? 'Searching…' : `Nothing found for “${q}”.`}
            </div>
          )}
          {searching && rows.length > 0 && (
            <div className="palette__group u-xs u-mut">Still looking for more…</div>
          )}
        </div>
      </div>
    </div>
  )
}
