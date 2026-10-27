import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { Logo } from './Logo'
import { useApp } from '../lib/store'
import { useCloseOnBack } from '../lib/useCloseOnBack'
import { SECTION_META, TYPE_ORDER } from '../lib/format'

export function Shell({ children }: { children: ReactNode }) {
  const { sections, counts, toasts, dismissToast, setPaletteOpen, openLog, enrich } = useApp()
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()

  const used = TYPE_ORDER.filter((t) => {
    const s = sections.find((x) => x.type === t)
    return (s?.works ?? 0) > 0 || ['film', 'tv', 'book', 'audiobook', 'album'].includes(t)
  })

  useEffect(() => { setMoreOpen(false) }, [location.pathname])
  useCloseOnBack(moreOpen, () => setMoreOpen(false))

  return (
    <div className="shell">
      <nav className="rail" aria-label="Sections">
        <div className="rail__top">
          <Link to="/" className="rail__brand">
            <span className="rail__mark"><Logo size={22} /></span>
            <span className="u-col u-grow" style={{ minWidth: 0 }}>
              <span className="rail__name">Shelved</span>
              <span className="rail__sub">{counts.entries.toLocaleString('en-GB')} things logged</span>
            </span>
          </Link>
          <NavLink
            to="/settings"
            className={({ isActive }) => `iconbtn rail__cog${isActive ? ' is-active' : ''}`}
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" size={18} />
          </NavLink>
        </div>

        <NavLink to="/" end className={({ isActive }) => `nav${isActive ? ' is-active' : ''}`}>
          <span className="nav__icon"><Icon name="home" size={18} /></span>
          <span className="nav__label">Home</span>
        </NavLink>

        <div className="rail__group u-caps">Library</div>
        {used.map((type) => {
          const meta = SECTION_META[type]
          const s = sections.find((x) => x.type === type)
          return (
            <NavLink
              key={type}
              to={meta.path}
              style={{ ['--hue' as string]: meta.hue }}
              className={({ isActive }) => `nav${isActive ? ' is-active' : ''}`}
            >
              <span className="nav__icon"><Icon name={meta.icon} size={18} /></span>
              <span className="nav__label">{meta.label}</span>
              {s?.works ? <span className="nav__count u-tnum">{s.works}</span> : null}
            </NavLink>
          )
        })}

      </nav>

      <div className="main">
        {/* No header bar: search floats over the page, with room to see through. */}
        <div className="floatbar">
          {/*
            * The sidebar carries the name on a desktop, but it is hidden on a
            * phone, which left nothing at all saying what the app was.
            */}
          <Link to="/" className="floatbar__brand only-mobile" aria-label="Shelved — home">
            <span className="floatbar__mark"><Logo size={19} /></span>
            <span className="floatbar__name">Shelved</span>
          </Link>

          {enrich && enrich.pending > 0 && (
            <span
              className="fillpill"
              title={`Fetching artwork and details${enrich.lastTitle ? ` — ${enrich.lastTitle}` : ''}`}
            >
              <span className="spinner" />
              <span className="fillpill__text">
                Filling in details · <span className="u-tnum">{enrich.pending}</span> left
              </span>
            </span>
          )}
          <button className="searchbtn searchbtn--primary" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={16} />
            <span className="u-grow" style={{ textAlign: 'left' }}>Search or add something…</span>
          </button>
        </div>
        {children}
      </div>

      <nav className="tabbar" aria-label="Sections">
        <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="home" size={19} /><span>Home</span>
        </NavLink>
        <button className="tab" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={19} /><span>Search</span>
        </button>
        <button
          className={`tab${moreOpen ? ' is-active' : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
        >
          <Icon name="menu" size={19} /><span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="scrim scrim--bottom" onMouseDown={(e) => { if (e.target === e.currentTarget) setMoreOpen(false) }}>
          <div className="sheet moresheet" role="dialog" aria-modal="true" aria-label="More">
            <div className="sheet__head">
              <span className="sheet__title u-grow">Your library</span>
              <button className="iconbtn" onClick={() => setMoreOpen(false)} aria-label="Close"><Icon name="x" size={17} /></button>
            </div>
            <div className="moresheet__grid">
              {used.map((type) => {
                const m = SECTION_META[type]
                const s = sections.find((x) => x.type === type)
                return (
                  <Link key={type} to={m.path} className="moretile" style={{ ['--hue' as string]: m.hue }}>
                    <span className="moretile__icon"><Icon name={m.icon} size={19} /></span>
                    <span className="moretile__label">{m.label}</span>
                    {s?.works ? <span className="u-xs u-mut u-tnum">{s.works}</span> : null}
                  </Link>
                )
              })}
            </div>
            <div className="sheet__head" style={{ borderTop: '1px solid var(--hairline)', borderBottom: 'none' }}>
              <span className="sheet__title u-grow">Everything else</span>
            </div>
            <div className="moresheet__list">
              <Link to="/settings" className="palette__item"><Icon name="settings" size={18} /> <span className="u-grow">Settings</span></Link>
              <Link to="/stats" className="palette__item"><Icon name="chart" size={18} /> <span className="u-grow">Stats</span></Link>
              <Link to="/connections" className="palette__item"><Icon name="key" size={18} /> <span className="u-grow">Connections</span></Link>
              <Link to="/import" className="palette__item"><Icon name="import" size={18} /> <span className="u-grow">Import</span></Link>
            </div>
          </div>
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'error' ? ' toast--error' : t.tone === 'info' ? ' toast--info' : ''}`} onClick={() => dismissToast(t.id)}>
            <span className="toast__dot" />
            <span className="u-grow">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

