import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

/*
 * Charts are hand-rolled SVG so they inherit the app's tokens exactly.
 * Colour rules: every chart here is single-series, so identity comes from the
 * axis labels and the title — never from hue. The two series colours and the
 * sequential ramp were validated against the dark surface (#0f1116) for
 * lightness band, chroma floor and >=3:1 contrast.
 */

const PRIMARY = 'var(--viz-primary)'
const AMBER = 'var(--viz-amber)'

/** Wrapper: title, optional note, and the table view the charts fall back to. */
export function ChartFrame({ title, note, children, table, right }: {
  title: string
  note?: string
  children: ReactNode
  table?: { head: string[]; rows: (string | number)[][] }
  right?: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  return (
    <section className="card chartcard">
      <div className="u-spread" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
        <div className="u-col" style={{ gap: 2 }}>
          <h3 style={{ fontSize: 14.5 }}>{title}</h3>
          {note && <span className="u-xs u-mut">{note}</span>}
        </div>
        <div className="u-row" style={{ gap: 6 }}>
          {right}
          {table && (
            <button
              className="iconbtn"
              onClick={() => setShowTable((v) => !v)}
              aria-label={showTable ? 'Show chart' : 'Show the numbers'}
              title={showTable ? 'Show chart' : 'Show the numbers'}
            >
              <Icon name={showTable ? 'chart' : 'rows'} size={15} />
            </button>
          )}
        </div>
      </div>
      {showTable && table
        ? (
          <div className="tablewrap">
            <table className="dtable">
              <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'u-tnum' : ''}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        : children}
    </section>
  )
}

export function StatTile({ label, value, sub, icon, hue }: {
  label: string
  value: string | number
  sub?: string
  icon?: string
  hue?: string
}) {
  return (
    <div className="stattile stattile--plain">
      {icon && <span className="stattile__icon" style={{ color: hue }}><Icon name={icon} size={17} /></span>}
      <span className="stattile__value u-tnum">{value}</span>
      <span className="stattile__label">{label}</span>
      {sub && <span className="stattile__foot">{sub}</span>}
    </div>
  )
}

/** Vertical bars. Direct label on the tallest bar only; the rest on hover. */
export function BarChart({ data, color = AMBER, height = 170, format = (n: number) => String(n), xLabel }: {
  data: { label: string; value: number; note?: string }[]
  color?: string
  height?: number
  format?: (n: number) => string
  xLabel?: (label: string) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...data.map((d) => d.value), 1)
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0)
  const plotH = height - 26

  if (!data.length) return <p className="u-sm u-mut" style={{ margin: 0 }}>Not enough data yet.</p>

  return (
    <div className="chart" style={{ position: 'relative' }}>
      <div className="chart__bars" style={{ height }}>
        {[0.5, 1].map((t) => (
          <span key={t} className="chart__gridline" style={{ bottom: 26 + plotH * t }} />
        ))}
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * plotH)
          const isHover = hover === i
          return (
            <div
              key={d.label + i}
              className="chart__barcol"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {(i === peak || isHover) && d.value > 0 && (
                <span className="chart__barvalue u-tnum" style={{ bottom: h + 30 }}>{format(d.value)}</span>
              )}
              <span
                className="chart__bar"
                style={{ height: h, background: color, opacity: isHover ? 1 : 0.86 }}
              />
              <span className="chart__barlabel">{xLabel ? xLabel(d.label) : d.label}</span>
            </div>
          )
        })}
      </div>
      {hover != null && data[hover]?.note && (
        <div className="chart__tip">{data[hover].note}</div>
      )}
    </div>
  )
}

/** Horizontal bars with the category name and value as direct labels. */
export function HBarChart({ data, color = PRIMARY }: {
  data: { label: string; value: number; note?: string }[]
  color?: string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  if (!data.length) return <p className="u-sm u-mut" style={{ margin: 0 }}>Not enough data yet.</p>
  return (
    <div className="u-col" style={{ gap: 9 }}>
      {data.map((d) => (
        <div key={d.label} className="hbar">
          <span className="hbar__label u-sm u-trunc" style={{ textTransform: 'capitalize' }}>{d.label}</span>
          <span className="hbar__track">
            <span className="hbar__fill" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </span>
          <span className="hbar__value u-xs u-tnum u-mut">{d.value}{d.note ? ` · ${d.note}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

/** Line + area with a crosshair and tooltip. One measure, one axis. */
export function LineChart({ data, height = 190, color = PRIMARY, format = (n: number) => String(n) }: {
  data: { label: string; value: number }[]
  height?: number
  color?: string
  format?: (n: number) => string
}) {
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  if (data.length < 2) return <p className="u-sm u-mut" style={{ margin: 0 }}>Not enough history yet.</p>

  const w = 760
  const h = height
  const pad = { l: 34, r: 12, t: 12, b: 24 }
  const max = Math.max(...data.map((d) => d.value), 1)
  const stepX = (w - pad.l - pad.r) / (data.length - 1)
  const x = (i: number) => pad.l + i * stepX
  const y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b)

  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ')
  const area = `${line} L${x(data.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const ticks = [0, Math.round(max / 2), max]
  const labelEvery = Math.max(1, Math.ceil(data.length / 9))

  return (
    <div className="chart" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * w
          const i = Math.round((px - pad.l) / stepX)
          setHover(Math.max(0, Math.min(data.length - 1, i)))
        }}
        role="img"
        aria-label="Activity over time"
      >
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth="1" />
            <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-4)">{t}</text>
          </g>
        ))}
        <path d={area} fill={`url(#g${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (i % labelEvery === 0 ? (
          <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--ink-4)">{d.label}</text>
        ) : null))}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} stroke="var(--hairline-strong)" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(data[hover].value)} r="5" fill={color} stroke="var(--viz-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="chart__tip" style={{ left: `${(x(hover) / w) * 100}%` }}>
          <strong>{format(data[hover].value)}</strong> · {data[hover].label}
        </div>
      )}
    </div>
  )
}

/** A year of activity as a 7×53 grid; sequential one-hue ramp. */
export function Heatmap({ days, endDate }: { days: Record<string, number>; endDate?: string }) {
  const [hover, setHover] = useState<{ date: string; count: number } | null>(null)
  // If the log stops before today (an old export, say), end the grid at the
  // last day with data rather than showing a year of blanks.
  const today = endDate ? new Date(endDate + 'T12:00:00') : new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // back to a Monday

  const weeks: { date: string; count: number }[][] = []
  const cursor = new Date(start)
  while (cursor <= today) {
    const week: { date: string; count: number }[] = []
    for (let d = 0; d < 7; d++) {
      const iso = cursor.toISOString().slice(0, 10)
      week.push({ date: iso, count: cursor <= today ? (days[iso] || 0) : -1 })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }

  const steps = ['var(--viz-seq-1)', 'var(--viz-seq-2)', 'var(--viz-seq-3)', 'var(--viz-seq-4)', 'var(--viz-seq-5)']
  const colour = (count: number) => {
    if (count <= 0) return 'var(--surface-2)'
    if (count === 1) return steps[0]
    if (count === 2) return steps[1]
    if (count <= 4) return steps[2]
    if (count <= 7) return steps[3]
    return steps[4]
  }

  const monthLabels: { index: number; label: string }[] = []
  let lastMonth = -1
  weeks.forEach((week, i) => {
    const m = new Date(week[0].date).getMonth()
    if (m !== lastMonth) {
      lastMonth = m
      monthLabels.push({ index: i, label: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][m] })
    }
  })

  return (
    <div style={{ position: 'relative' }}>
      <div className="heat">
        <div className="heat__months">
          {monthLabels.map((m) => (
            <span key={m.index + m.label} style={{ gridColumnStart: m.index + 1 }}>{m.label}</span>
          ))}
        </div>
        <div className="heat__grid">
          {weeks.map((week, wi) => (
            <div key={wi} className="heat__week">
              {week.map((day) => (
                <span
                  key={day.date}
                  className="heat__cell"
                  style={{ background: day.count < 0 ? 'transparent' : colour(day.count) }}
                  onMouseEnter={() => day.count >= 0 && setHover(day)}
                  onMouseLeave={() => setHover(null)}
                  aria-hidden="true"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="u-row u-spread" style={{ marginTop: 10 }}>
        <span className="u-xs u-mut">{hover ? `${hover.count} logged on ${hover.date}` : 'Hover a day for the count'}</span>
        <span className="u-row u-xs u-mut" style={{ gap: 5 }}>
          quiet
          {['var(--surface-2)', ...steps].map((c) => (
            <span key={c} className="heat__cell" style={{ background: c, width: 11, height: 11 }} />
          ))}
          busy
        </span>
      </div>
    </div>
  )
}
