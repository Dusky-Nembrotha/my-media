import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { BarChart, ChartFrame, HBarChart, Heatmap, LineChart, StatTile } from '../components/Charts'
import { Empty } from '../components/Modal'
import { useFetch } from '../lib/store'
import { qs } from '../lib/api'
import { SECTION_META, TYPE_ORDER, fmtMonth, fmtNumber } from '../lib/format'
import type { MediaType } from '../lib/types'

export function StatsPage() {
  const [type, setType] = useState<MediaType | 'all'>('all')
  const query = qs({ type: type === 'all' ? null : type })
  const { data, loading } = useFetch<any>(`/stats${query}`, [query])
  const profile = useFetch<any>('/profile')

  if (loading && !data) {
    return <div className="page"><div className="skel" style={{ height: 120, marginBottom: 16 }} /><div className="skel" style={{ height: 260 }} /></div>
  }
  if (!data || !data.totals?.entries) {
    return <div className="page"><Empty icon="chart" title="No numbers yet" action={<Link className="btn btn--primary" to="/import">Import your history</Link>}>Log a few things and this page fills with charts.</Empty></div>
  }

  const t = data.totals
  const months = (data.byMonth ?? []).slice(-30)
  const heatDays: Record<string, number> = {}
  for (const row of data.heatmap ?? []) heatDays[row.day] = row.c
  const todayIso = new Date().toISOString().slice(0, 10)
  // The server ends the window at your latest entry when that is in the past.
  const heatEnd = data.heatmapEnd && data.heatmapEnd < todayIso ? data.heatmapEnd : undefined

  const ratingBuckets = Array.from({ length: 10 }, (_, i) => {
    const value = (i + 1) / 2
    const found = (data.histogram ?? []).find((h: any) => Number(h.rating) === value)
    return { label: value % 1 ? `${value}` : `${value}`, value: found?.c ?? 0, note: `${found?.c ?? 0} rated ${value}★` }
  })

  return (
    <div className="page">
      <div className="filterbar" style={{ marginTop: 0 }}>
        <div className="chiprow u-grow scrollrow">
          <button className={`chip${type === 'all' ? ' is-on' : ''}`} onClick={() => setType('all')}>Everything</button>
          {TYPE_ORDER.filter((x) => (data.byType ?? []).some((b: any) => b.type === x)).map((x) => (
            <button key={x} className={`chip${type === x ? ' is-on' : ''}`} onClick={() => setType(x)}>{SECTION_META[x].label}</button>
          ))}
        </div>
      </div>

      <div className="statstrip statstrip--wide">
        <StatTile label="Log entries" value={fmtNumber(t.entries)} icon="calendar" sub={`${fmtNumber(t.works)} distinct titles`} />
        <StatTile label="Average rating" value={t.avg_rating ? `${t.avg_rating.toFixed(2)}★` : '—'} icon="star" hue="var(--star)" sub={`${fmtNumber(t.rated)} rated`} />
        {t.hours ? <StatTile label="Hours logged" value={fmtNumber(t.hours)} icon="clock" sub={t.days ? `${t.days} full days` : undefined} /> : null}
        {t.pages ? <StatTile label="Pages read" value={fmtNumber(t.pages)} icon="book" /> : null}
        <StatTile label="Span" value={t.first_on ? `${String(t.first_on).slice(0, 4)}–${String(t.last_on).slice(0, 4)}` : '—'} icon="chart" sub="first to last entry" />
      </div>

      <div className="chartgrid">
        <ChartFrame
          title="How you rate"
          note="Your own distribution — most people are kinder than they think"
          table={{ head: ['Rating', 'Count'], rows: ratingBuckets.map((b) => [`${b.label}★`, b.value]) }}
        >
          <BarChart data={ratingBuckets} color="var(--viz-amber)" xLabel={(l) => (Number(l) % 1 === 0 ? l : '')} />
        </ChartFrame>

        <ChartFrame
          title="Activity by month"
          note="Entries logged per month, last 30 months"
          table={{ head: ['Month', 'Entries', 'Avg rating'], rows: months.map((m: any) => [m.month, m.c, m.avg_rating ?? '—']) }}
        >
          <LineChart data={months.map((m: any) => ({ label: fmtMonth(m.month), value: m.c }))} format={(n) => `${n} entries`} />
        </ChartFrame>

        <ChartFrame
          title="A year of logging"
          note={heatEnd ? `One square per day · ending ${heatEnd}, your latest entry` : 'One square per day'}
        >
          <Heatmap days={heatDays} endDate={heatEnd} />
        </ChartFrame>

        <ChartFrame
          title="Top genres"
          note="How often they appear · your average rating for each"
          table={{ head: ['Genre', 'Count', 'Avg'], rows: (data.genres ?? []).map((g: any) => [g.name, g.count, g.avg_rating ?? '—']) }}
        >
          <HBarChart data={(data.genres ?? []).slice(0, 10).map((g: any) => ({
            label: g.name, value: g.count, note: g.avg_rating ? `${g.avg_rating}★` : undefined,
          }))} />
        </ChartFrame>

        <ChartFrame
          title="When it was made"
          note="Release decades in your library"
          table={{ head: ['Decade', 'Titles', 'Avg'], rows: (data.releaseYears ?? []).map((r: any) => [`${r.decade}s`, r.c, r.avg_rating ?? '—']) }}
        >
          <BarChart
            data={(data.releaseYears ?? []).map((r: any) => ({
              label: `${String(r.decade).slice(2)}s`,
              value: r.c,
              note: `${r.c} titles from the ${r.decade}s${r.avg_rating ? ` · avg ${r.avg_rating}★` : ''}`,
            }))}
          />
        </ChartFrame>

        <ChartFrame
          title="Most logged people"
          note="Directors, authors and artists you return to"
          table={{ head: ['Name', 'Titles', 'Avg'], rows: (data.creators ?? []).map((c: any) => [c.name, c.count, c.avg_rating ?? '—']) }}
        >
          <HBarChart data={(data.creators ?? []).slice(0, 10).map((c: any) => ({
            label: c.name, value: c.count, note: c.avg_rating ? `${c.avg_rating}★` : undefined,
          }))} />
        </ChartFrame>

        {type === 'all' && (
          <ChartFrame
            title="Across the sections"
            note="Entries per media type"
            table={{ head: ['Section', 'Entries', 'Titles', 'Avg'], rows: (data.byType ?? []).map((b: any) => [b.label, b.entries, b.works, b.avg_rating ?? '—']) }}
          >
            <HBarChart data={(data.byType ?? []).map((b: any) => ({
              label: b.label, value: b.entries, note: b.avg_rating ? `${b.avg_rating}★` : undefined,
            }))} />
          </ChartFrame>
        )}

        <ChartFrame title="Where it came from" note="Which import or action created each entry"
          table={{ head: ['Source', 'Entries'], rows: (data.sources ?? []).map((s: any) => [s.source, s.c]) }}>
          <HBarChart data={(data.sources ?? []).map((s: any) => ({ label: s.source, value: s.c }))} />
        </ChartFrame>
      </div>

      {profile.data?.counts?.rated ? (
        <section style={{ marginTop: 8 }}>
          <div className="section-head">
            <div>
              <h2>Your taste, measured</h2>
              <p>
                You rate {profile.data.globalMean?.toFixed(2)}★ on average. These sit above that line,
                and they are exactly what the recommendation engine uses.
              </p>
            </div>
            <Link className="btn btn--sm" to="/recommended"><Icon name="sparkle" size={14} /> See picks</Link>
          </div>
          <div className="chartgrid">
            <ChartFrame title="Genres you over-rate" note="Deviation from your own average, in stars">
              <HBarChart
                color="var(--viz-amber)"
                data={(profile.data.genres ?? []).slice(0, 8).map((g: any) => ({
                  label: g.label, value: Math.round(g.score * 100) / 100, note: `${g.n} titles`,
                }))}
              />
            </ChartFrame>
            <ChartFrame title="People you over-rate" note="Deviation from your own average, in stars">
              <HBarChart
                color="var(--viz-amber)"
                data={(profile.data.creators ?? []).slice(0, 8).map((c: any) => ({
                  label: c.label, value: Math.round(c.score * 100) / 100, note: `${c.n} titles`,
                }))}
              />
            </ChartFrame>
          </div>
        </section>
      ) : null}
    </div>
  )
}
