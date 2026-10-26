import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Stars } from '../components/Stars'
import { Empty } from '../components/Modal'
import { useFetch } from '../lib/store'
import { qs } from '../lib/api'
import { SECTION_META, TYPE_ORDER, creatorLine, fmtDate, statusLabel } from '../lib/format'
import type { ActivityItem, MediaType } from '../lib/types'

export function DiaryPage() {
  const [type, setType] = useState<MediaType | 'all'>('all')
  const [limit, setLimit] = useState(60)
  const query = qs({ type: type === 'all' ? null : type, limit })
  const { data, loading } = useFetch<{ activity: ActivityItem[]; total: number }>(`/activity${query}`, [query])

  const groups = groupByMonth(data?.activity ?? [])

  return (
    <div className="page">
      <div className="filterbar" style={{ marginTop: 0 }}>
        <div className="chiprow scrollrow">
          <button className={`chip${type === 'all' ? ' is-on' : ''}`} onClick={() => setType('all')}>Everything</button>
          {TYPE_ORDER.map((t) => (
            <button key={t} className={`chip${type === t ? ' is-on' : ''}`} onClick={() => setType(t)}>
              {SECTION_META[t].label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="u-col" style={{ gap: 10 }}>
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" style={{ height: 64 }} />)}
        </div>
      ) : !groups.length ? (
        <Empty icon="calendar" title="Your diary is empty">Log something, or import an export, and it will appear here.</Empty>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.key} style={{ marginBottom: 28 }}>
              <div className="diary__month">
                <h2>{g.label}</h2>
                <span className="u-sm u-mut u-tnum">{g.items.length} logged</span>
              </div>
              <div className="card" style={{ padding: 6 }}>
                {g.items.map((a) => (
                  <Link key={a.entry_id} to={`/work/${a.work_id}`} className="diaryrow">
                    <span className="diaryrow__day u-tnum">
                      {a.consumed_on ? Number(a.consumed_on.slice(8, 10)) : '–'}
                    </span>
                    {a.poster_url
                      ? <img className="diaryrow__thumb" src={a.poster_url} alt="" loading="lazy" style={{ aspectRatio: SECTION_META[a.type].aspect }} />
                      : <span className="diaryrow__thumb" style={{ aspectRatio: SECTION_META[a.type].aspect }} />}
                    <span className="u-col u-grow" style={{ gap: 4, minWidth: 0 }}>
                      <span className="u-row u-wrap" style={{ gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 560 }}>{a.title}</span>
                        {a.year && <span className="u-xs u-mut u-tnum">{a.year}</span>}
                        {a.is_repeat && <span className="pill"><Icon name="repeat" size={10} /> again</span>}
                        {statusLabel(a.status, a.type) && <span className="pill pill--warn">{statusLabel(a.status, a.type)}</span>}
                      </span>
                      <span className="u-xs u-mut u-trunc">
                        {[SECTION_META[a.type].label, creatorLine(a.creators, 1), a.progress].filter(Boolean).join(' · ')}
                      </span>
                      {a.review && <span className="u-xs u-clamp-2" style={{ color: 'var(--ink-2)' }}>{a.review}</span>}
                    </span>
                    <span className="u-col" style={{ alignItems: 'flex-end', gap: 4, flex: '0 0 auto' }}>
                      {a.rating != null && <Stars value={a.rating} size={13} />}
                      <span className="u-xs u-mut">{fmtDate(a.consumed_on)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          {data && data.total > (data.activity?.length ?? 0) && (
            <div style={{ display: 'grid', placeItems: 'center' }}>
              <button className="btn" onClick={() => setLimit((l) => l + 60)}>Load more</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function groupByMonth(items: ActivityItem[]) {
  const map = new Map<string, ActivityItem[]>()
  for (const item of items) {
    const key = item.consumed_on ? item.consumed_on.slice(0, 7) : 'undated'
    const list = map.get(key) || []
    list.push(item)
    map.set(key, list)
  }
  return [...map.entries()].map(([key, list]) => ({
    key,
    label: key === 'undated'
      ? 'Date unknown'
      : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`,
    items: list,
  }))
}
