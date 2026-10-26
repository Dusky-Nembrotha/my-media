import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { useApp } from '../lib/store'
import { SECTION_META, TYPE_ORDER } from '../lib/format'

export function Shell({ children }: { children: ReactNode }) {
  const { sections, counts, toasts, dismissToast, setPaletteOpen, openLog, enrich } = useApp()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mm-rail') === 'collapsed')
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()

  const toggleRail = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('mm-rail', next ? 'collapsed' : 'open')
  }

  const used = TYPE_ORDER.filter((t) => {
    const s = sections.find((x) => x.type === t)
    return (s?.works ?? 0) > 0 || ['film', 'tv', 'book', 'audiobook', 'album'].includes(t)
  })

  useEffect(() => { setMoreOpen(false) }, [location.pathname])

  const title = pageTitle(location.pathname, sections)
  const sectionType = TYPE_ORDER.find((t) => SECTION_META[t].path === location.pathname) ?? null

  return (
    <div className="shell" data-collapsed={collapsed}>
      <nav className="rail" aria-label="Sections">
        <Link to="/" className="rail__brand">
          <span className="rail__mark">M</span>
          <span className="u-col u-grow" style={{ minWidth: 0 }}>
            <span className="rail__name">My Media</span>
            <span className="rail__sub">{counts.entries.toLocaleString('en-GB')} things logged</span>
          </span>
        </Link>

        <NavLink to="/" end className={({ isActive }) => `nav${isActive ? ' is-active' : ''}`}>
          <span className="nav__icon"><Icon name="home" size={18} /></span>
          <span className="nav__label">Home</span>
        </NavLink>
        <NavLink to="/diary" className={({ isActive }) => `nav${isActive ? ' is-active' : ''}`}>
          <span className="nav__icon"><Icon name="calendar" size={18} /></span>
          <span className="nav__label">Diary</span>
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

        <div className="rail__group u-caps">Discover</div>
        <NavLink to="/recommended" className={({ isActive }) => `nav${isActive ? ' is-active' : ''}`}>
          <span className="nav__icon"><Icon name="sparkle" size={18} /></span>
          <span className="nav__label">For you</span>
        </NavLink>

        <NavLink to="/settings" className={({ isActive }) => `nav${isActive ? ' is-active' : ''}`}>
          <span className="nav__icon"><Icon name="settings" size={18} /></span>
          <span className="nav__label">Settings</span>
        </NavLink>

        <div className="rail__footer">
          <div className="rail__hint"><kbd>⌘</kbd><kbd>K</kbd> to search anything</div>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button className="iconbtn only-desktop" onClick={toggleRail} aria-label="Toggle sidebar" title="Toggle sidebar">
            <Icon name="menu" size={18} />
          </button>
          <Link to="/settings" className="iconbtn only-mobile" aria-label="Settings" title="Settings">
            <Icon name="settings" size={18} />
          </Link>
          {sectionType && (
            <span
              className="topbar__mark"
              style={{
                color: SECTION_META[sectionType].hue,
                background: `color-mix(in oklab, ${SECTION_META[sectionType].hue} 14%, transparent)`,
              }}
            >
              <Icon name={SECTION_META[sectionType].icon} size={17} />
            </span>
          )}
          <div className="u-col u-grow" style={{ minWidth: 0 }}>
            <span className="topbar__title u-trunc">{title.title}</span>
            {title.crumb && <span className="topbar__crumb u-trunc">{title.crumb}</span>}
          </div>
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
            <span className="u-grow" style={{ textAlign: 'left' }}>Search or log something…</span>
            <kbd>⌘K</kbd>
          </button>

        </header>
        {children}
      </div>

      <nav className="tabbar" aria-label="Sections">
        <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="home" size={19} /><span>Home</span>
        </NavLink>
        <NavLink to="/diary" className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="calendar" size={19} /><span>Diary</span>
        </NavLink>
        <NavLink to="/recommended" className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="sparkle" size={19} /><span>For you</span>
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

function pageTitle(path: string, sections: { type: string; label: string; works: number; entries: number; avg_rating: number | null }[]) {
  const section = TYPE_ORDER.find((t) => SECTION_META[t].path === path)
  if (section) {
    const s = sections.find((x) => x.type === section)
    return {
      title: SECTION_META[section].label,
      crumb: s
        ? [`${s.works} titles`, `${s.entries} entries`, s.avg_rating != null ? `avg ${s.avg_rating.toFixed(2)}★` : null]
          .filter(Boolean).join(' · ')
        : null,
    }
  }
  const map: Record<string, { title: string; crumb: string | null }> = {
    '/': { title: 'Home', crumb: null },
    '/diary': { title: 'Diary', crumb: 'Everything you have logged, newest first' },
    '/recommended': { title: 'For you', crumb: 'Built from your own ratings' },
    '/inbox': { title: 'To check out', crumb: 'Everything you have been meaning to get to' },
    '/stats': { title: 'Stats', crumb: null },
    '/import': { title: 'Import', crumb: 'Bring in Letterboxd, Goodreads, Audible, Spotify and more' },
    '/connections': { title: 'Connections', crumb: 'Live sync, API keys and how to export from everywhere else' },
    '/settings': { title: 'Settings', crumb: null },
  }
  if (map[path]) return map[path]
  if (path.startsWith('/work/')) return { title: '', crumb: null }
  if (path.startsWith('/lists/')) return { title: 'List', crumb: null }
  return { title: 'My Media', crumb: null }
}
