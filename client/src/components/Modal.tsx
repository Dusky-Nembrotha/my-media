import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { useCloseOnBack } from '../lib/useCloseOnBack'

export function Modal({ title, onClose, children, footer, wide, className }: {
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  className?: string
}) {
  // Back closes it, the same as Escape and the close button.
  useCloseOnBack(true, onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`sheet${wide ? ' sheet--wide' : ''}${className ? ' ' + className : ''}`} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="sheet__head">
            <div className="sheet__title u-grow">{title}</div>
            <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" size={17} /></button>
          </div>
        )}
        {children}
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * A request that did not come back, said so.
 *
 * Every page here fetches on mount and renders "Loading…" until the data
 * arrives — which, if the request fails, is for ever. A server restart mid-use
 * left the import page claiming it was still loading its importers with no
 * error, no retry and nothing to do but guess at a refresh. A failure is not a
 * slow success, and should never be shown as one.
 */
export function Failed({ what, error, onRetry }: {
  what: string
  error?: string | null
  onRetry: () => void
}) {
  return (
    <Empty
      icon="refresh"
      title={`Could not load ${what}`}
      action={<button className="btn btn--primary" onClick={onRetry}>Try again</button>}
    >
      {error || 'The server did not answer. If it was restarting, a retry usually settles it.'}
    </Empty>
  )
}

export function Empty({ icon = 'sparkle', title, children, action }: {
  icon?: string
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty__mark"><Icon name={icon} size={30} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}
