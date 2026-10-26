import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

/** Horizontal scrolling shelf with hover arrows — the "slick menu" workhorse. */
export function Row({ title, subtitle, action, children, cardWidth = 152 }: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  cardWidth?: number
}) {
  const track = useRef<HTMLDivElement>(null)
  const nudge = (dir: number) => {
    const el = track.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 320), behavior: 'smooth' })
  }

  return (
    <section className="row" style={{ marginBottom: 30 }}>
      {(title || action) && (
        <div className="section-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <button className="row__nav row__nav--prev" onClick={() => nudge(-1)} aria-label="Scroll left">
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="row__track" ref={track} style={{ ['--card-w' as string]: `${cardWidth}px` }}>
          {children}
        </div>
        <button className="row__nav row__nav--next" onClick={() => nudge(1)} aria-label="Scroll right">
          <Icon name="chevronRight" size={18} />
        </button>
      </div>
    </section>
  )
}
