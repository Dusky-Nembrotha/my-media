import { useState } from 'react'

/**
 * Half-star rating. Read-only by default; pass onChange to make it an input.
 * Clicking the left half of a star gives x.5, the right half gives x.0.
 */
export function Stars({ value, size = 15, onChange, showValue = false, color = 'var(--star)' }: {
  value: number | null | undefined
  size?: number
  onChange?: (value: number | null) => void
  showValue?: boolean
  color?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0
  const interactive = Boolean(onChange)

  return (
    <span className={`stars${interactive ? ' stars--interactive' : ''}`} onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, shown - (i - 1)))
        const star = (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id={`st${i}-${size}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor={color} />
                <stop offset={`${fill * 100}%`} stopColor="transparent" />
              </linearGradient>
            </defs>
            <path
              d="M12 2.8l2.76 5.84 6.24.86-4.6 4.3 1.16 6.2L12 16.95 6.44 20l1.16-6.2L3 9.5l6.24-.86z"
              fill={`url(#st${i}-${size}-${Math.round(fill * 100)})`}
              stroke={fill > 0 ? color : 'var(--ink-4)'}
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        )
        if (!interactive) return <span key={i} style={{ lineHeight: 0 }}>{star}</span>
        return (
          <span key={i} style={{ position: 'relative', lineHeight: 0 }}>
            <button
              type="button"
              className="stars__hit"
              aria-label={`${i - 0.5} stars`}
              style={{ position: 'absolute', inset: 0, width: '50%', zIndex: 2 }}
              onMouseEnter={() => setHover(i - 0.5)}
              onClick={() => onChange?.(value === i - 0.5 ? null : i - 0.5)}
            />
            <button
              type="button"
              className="stars__hit"
              aria-label={`${i} stars`}
              style={{ position: 'absolute', inset: 0, left: '50%', width: '50%', zIndex: 2 }}
              onMouseEnter={() => setHover(i)}
              onClick={() => onChange?.(value === i ? null : i)}
            />
            {star}
          </span>
        )
      })}
      {showValue && (value ?? hover) ? (
        <span className="u-sm u-tnum" style={{ marginLeft: 6, color: 'var(--ink-2)' }}>{(hover ?? value)?.toFixed(1)}</span>
      ) : null}
    </span>
  )
}
