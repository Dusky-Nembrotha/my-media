import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PosterCard, PosterSkeleton } from '../components/Poster'
import { Stars } from '../components/Stars'
import { Empty, Modal } from '../components/Modal'
import { useApp, useFetch } from '../lib/store'
import { qs } from '../lib/api'
import { SECTION_META, creatorLine, fmtDate, fmtRuntime, relDate } from '../lib/format'
import { api } from '../lib/api'
import { artworkUrl } from '../lib/img'
import type { MediaType, Rec, WorkCard } from '../lib/types'
import { PosterArt } from '../components/Poster'

const SORTS = [
  ['recent', 'Last logged'],
  ['rating', 'Your rating'],
  ['added', 'Recently added'],
  ['title', 'Title'],
  ['year', 'Release year'],
] as const

const RATINGS = [4.5, 4, 3] as const

const STATUSES = [
  ['in_progress', 'In progress'],
  ['completed', 'Finished'],
  ['abandoned', 'Gave up'],
  ['unlogged', 'Not logged'],
] as const

interface Filters {
  genre: string | null
  decade: string | null
  minRating: number | null
  status: string | null
  unrated: boolean
}

const EMPTY: Filters = { genre: null, decade: null, minRating: null, status: null, unrated: false }

export function SectionPage({ type }: { type: MediaType }) {
  const meta = SECTION_META[type]
  const [tab, setTab] = useState<'done' | 'planned'>('done')
  const [sort, setSort] = useState<string>('recent')
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('mm-view') as 'grid' | 'list') || 'grid')
  const [limit, setLimit] = useState(60)
  const [q, setQ] = useState('')

  const query = qs({
    type, sort, limit, q: q.trim() || null,
    genre: filters.genre, decade: filters.decade,
    minRating: filters.minRating, status: filters.status,
    unrated: filters.unrated ? 1 : null,
  })
  const { version } = useApp()
  const { data, loading } = useFetch<{ works: WorkCard[]; total: number }>(`/works${query}`, [query, version])
  const facets = useFetch<{ genres: { name: string; count: number }[]; decades: { name: string; count: number }[] }>(`/facets${qs({ type })}`)

  const active = useMemo(() => {
    const out: { key: keyof Filters; label: string }[] = []
    if (filters.genre) out.push({ key: 'genre', label: filters.genre })
    if (filters.decade) out.push({ key: 'decade', label: filters.decade })
    if (filters.minRating) out.push({ key: 'minRating', label: `${filters.minRating}★ and up` })
    if (filters.status) out.push({ key: 'status', label: STATUSES.find((s) => s[0] === filters.status)?.[1] ?? filters.status })
    if (filters.unrated) out.push({ key: 'unrated', label: 'Unrated' })
    return out
  }, [filters])

  const works = data?.works ?? []
  const setViewPersist = (v: 'grid' | 'list') => { setView(v); localStorage.setItem('mm-view', v) }
  const clearOne = (key: keyof Filters) => setFilters((f) => ({ ...f, [key]: key === 'unrated' ? false : null }))
  const clearAll = () => { setFilters(EMPTY); setQ('') }

  if (tab === 'planned') {
    return (
      <div className="page">
        <SectionTabs type={type} tab={tab} setTab={setTab} />
        <PlannedList type={type} />
      </div>
    )
  }

  return (
    <div className="page">
      <SectionTabs type={type} tab={tab} setTab={setTab} />
      <div className="toolbar">
        <label className="toolbar__search">
          <Icon name="search" size={15} className="u-mut" />
          <input
            className="toolbar__input"
            placeholder={`Filter ${meta.label.toLowerCase()}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={`Filter ${meta.label}`}
          />
          {q && (
            <button className="toolbar__clear" onClick={() => setQ('')} aria-label="Clear filter text">
              <Icon name="x" size={13} />
            </button>
          )}
        </label>

        <div className="selectwrap toolbar__sort">
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <button
          className={`btn btn--sm toolbar__filters${active.length ? ' is-on' : ''}`}
          onClick={() => setSheetOpen(true)}
        >
          <Icon name="filter" size={14} />
          <span className="toolbar__filterlabel">Filters</span>
          {active.length > 0 && <span className="toolbar__badge u-tnum">{active.length}</span>}
        </button>

        <div className="viewtoggle">
          <button className={view === 'grid' ? 'is-on' : ''} onClick={() => setViewPersist('grid')} aria-label="Grid view"><Icon name="grid" size={15} /></button>
          <button className={view === 'list' ? 'is-on' : ''} onClick={() => setViewPersist('list')} aria-label="List view"><Icon name="rows" size={15} /></button>
        </div>
      </div>

      {active.length > 0 && (
        <div className="chiprow activefilters">
          {active.map((a) => (
            <button key={a.key} className="chip is-on" onClick={() => clearOne(a.key)} title="Remove this filter">
              {a.label} <Icon name="x" size={11} />
            </button>
          ))}
          <button className="chip" onClick={clearAll}>Clear all</button>
          {data && <span className="u-xs u-mut" style={{ marginLeft: 2 }}>{data.total} match{data.total === 1 ? '' : 'es'}</span>}
        </div>
      )}

      {loading && !works.length ? (
        <div className="grid">{Array.from({ length: 18 }, (_, i) => <PosterSkeleton key={i} aspect={meta.aspect} />)}</div>
      ) : !works.length ? (
        <Empty
          icon={meta.icon}
          title={active.length || q ? 'Nothing matches those filters' : `No ${meta.label.toLowerCase()} yet`}
          action={active.length || q
            ? <button className="btn" onClick={clearAll}>Clear filters</button>
            : <Link className="btn btn--primary" to="/import"><Icon name="import" size={15} /> Import your history</Link>}
        >
          {active.length || q ? null : `Log your first ${meta.singular.toLowerCase()} or import an export from another service.`}
        </Empty>
      ) : view === 'grid' ? (
        <>
          <div className="grid" style={{ ['--card-w' as string]: meta.aspect === '1 / 1' ? '164px' : '150px' }}>
            {works.map((w) => <PosterCard key={w.id} work={w} aspect={meta.aspect} />)}
          </div>
          {data && data.total > works.length && (
            <div style={{ display: 'grid', placeItems: 'center', marginTop: 26 }}>
              <button className="btn" onClick={() => setLimit((l) => l + 60)}>
                Show more — {data.total - works.length} to go
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {works.map((w) => (
            <Link key={w.id} to={`/work/${w.id}`} className="listrow">
              {w.poster_url
                ? <img className="listrow__thumb" src={artworkUrl(w.poster_url)} alt="" loading="lazy" style={{ aspectRatio: meta.aspect }} />
                : <span className="listrow__thumb" style={{ aspectRatio: meta.aspect }} />}
              <span className="u-col u-grow" style={{ gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 560 }} className="u-trunc">{w.title}</span>
                <span className="u-xs u-mut u-trunc">
                  {[w.year, creatorLine(w.creators, 2), w.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="listrow__right u-xs u-mut">{fmtRuntime(w.runtime) || (w.pages ? `${w.pages}p` : '')}</span>
              <span className="listrow__right">{w.rating != null ? <Stars value={w.rating} size={13} /> : <span className="u-xs u-mut">—</span>}</span>
              <span className="listrow__right u-xs u-mut">{fmtDate(w.last_on)}</span>
            </Link>
          ))}
        </div>
      )}

      {sheetOpen && (
        <Modal
          title={`Filter ${meta.label.toLowerCase()}`}
          onClose={() => setSheetOpen(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={clearAll}>Clear all</button>
              <button className="btn btn--primary" onClick={() => setSheetOpen(false)}>
                Show {data?.total ?? 0}
              </button>
            </>
          }
        >
          <div className="sheet__body">
            <div className="field sheet-sort">
              <label htmlFor="f-sort">Sort by</label>
              <div className="selectwrap">
                <select id="f-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="f-genre">Genre</label>
              <div className="selectwrap">
                <select
                  id="f-genre"
                  className="select"
                  value={filters.genre ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, genre: e.target.value || null }))}
                >
                  <option value="">All genres</option>
                  {(facets.data?.genres ?? []).map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="f-decade">Decade</label>
              <div className="selectwrap">
                <select
                  id="f-decade"
                  className="select"
                  value={filters.decade ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, decade: e.target.value || null }))}
                >
                  <option value="">Any decade</option>
                  {(facets.data?.decades ?? []).map((d) => <option key={d.name} value={d.name}>{d.name} ({d.count})</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label>Rating</label>
              <div className="chiprow">
                {RATINGS.map((r) => (
                  <button
                    key={r}
                    className={`chip${filters.minRating === r ? ' is-on' : ''}`}
                    onClick={() => setFilters((f) => ({ ...f, minRating: f.minRating === r ? null : r, unrated: false }))}
                  >
                    {r}★ and up
                  </button>
                ))}
                <button
                  className={`chip${filters.unrated ? ' is-on' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, unrated: !f.unrated, minRating: null }))}
                >
                  Unrated
                </button>
              </div>
            </div>

            <div className="field">
              <label>Status</label>
              <div className="chiprow">
                {STATUSES.map(([v, l]) => (
                  <button
                    key={v}
                    className={`chip${filters.status === v ? ' is-on' : ''}`}
                    onClick={() => setFilters((f) => ({ ...f, status: f.status === v ? null : v }))}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}


/** Switches a library between what you have finished and what you have not. */
function SectionTabs({ type, tab, setTab }: {
  type: MediaType
  tab: 'done' | 'planned'
  setTab: (t: 'done' | 'planned') => void
}) {
  const meta = SECTION_META[type]
  const { data } = useFetch<{ recs: Rec[] }>(`/recs?status=open&type=${type}`, [type])
  const waiting = data?.recs?.length ?? 0

  return (
    <div className="sectiontabs">
      <button className={tab === 'done' ? 'is-on' : ''} onClick={() => setTab('done')}>
        {meta.done}
      </button>
      <button className={tab === 'planned' ? 'is-on' : ''} onClick={() => setTab('planned')}>
        {meta.planned}
        {waiting > 0 && <span className="sectiontabs__count u-tnum">{waiting}</span>}
      </button>
    </div>
  )
}

/** The things you mean to get to, for this one kind of media. */
function PlannedList({ type }: { type: MediaType }) {
  const meta = SECTION_META[type]
  const { toast, refresh, openLog } = useApp()
  const { data, loading, reload } = useFetch<{ recs: Rec[] }>(`/recs?status=open&type=${type}`, [type])

  async function act(rec: Rec, what: 'log' | 'dismiss' | 'priority') {
    try {
      if (what === 'log') {
        await api.post('/recommendations/log', {
          pick: { type: rec.type || type, title: rec.title, year: rec.year, creators: rec.creators, poster_url: rec.poster_url },
          rec_id: rec.id,
        })
        toast(`Logged ${rec.title}`)
      } else if (what === 'dismiss') {
        await api.patch(`/recs/${rec.id}`, { status: 'dismissed' })
      } else {
        await api.patch(`/recs/${rec.id}`, { priority: rec.priority === 2 ? 1 : 2 })
      }
      reload()
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
  }

  if (loading && !data) {
    return <div className="grid">{Array.from({ length: 8 }, (_, i) => <PosterSkeleton key={i} aspect={meta.aspect} />)}</div>
  }

  const recs = data?.recs ?? []
  if (!recs.length) {
    return (
      <Empty
        icon="inbox"
        title={`Nothing on your ${meta.planned.toLowerCase()} list`}
        action={<button className="btn btn--primary" onClick={() => openLog({ kind: 'blank', type, mode: 'want' })}>
          <Icon name="plus" size={15} /> Add something
        </button>}
      >
        Search for anything and choose “Want to”, or import a watchlist — they land here.
      </Empty>
    )
  }

  return (
    <>
      <div className="u-spread" style={{ marginBottom: 14 }}>
        <span className="u-sm u-mut">{recs.length} waiting</span>
        <button className="btn btn--sm" onClick={() => openLog({ kind: 'blank', type, mode: 'want' })}>
          <Icon name="plus" size={14} /> Add
        </button>
      </div>
      <div className="grid" style={{ ['--card-w' as string]: meta.aspect === '1 / 1' ? '164px' : '150px' }}>
        {recs.map((rec) => (
          <div key={rec.id} className="plannedcard">
            <PosterArt src={rec.poster_url} title={rec.title} type={rec.type || type} aspect={meta.aspect} />
            <div className="poster__meta">
              <div className="poster__title">{rec.title}</div>
              <div className="poster__sub u-trunc">
                {[rec.year, rec.recommender].filter(Boolean).join(' · ')}
              </div>
              {rec.note && <div className="u-xs u-mut u-clamp-2" style={{ marginTop: 3 }}>{rec.note}</div>}
              <div className="plannedcard__actions">
                <button className="btn btn--sm btn--primary" onClick={() => act(rec, 'log')} title={`Mark as ${meta.done.toLowerCase()}`}>
                  <Icon name="check" size={13} />
                </button>
                <button className={`btn btn--sm${rec.priority === 2 ? ' btn--primary' : ''}`} onClick={() => act(rec, 'priority')} title="Priority">
                  <Icon name="star" size={13} />
                </button>
                <button className="btn btn--sm btn--ghost" onClick={() => act(rec, 'dismiss')} title="Not for me">
                  <Icon name="x" size={13} />
                </button>
              </div>
              {rec.added_at && <div className="u-xs u-mut" style={{ marginTop: 4 }}>added {relDate(rec.added_at.slice(0, 10))}</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
