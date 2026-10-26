import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function Modal({ title, onClose, children, footer, wide, className }: {
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  className?: string
}) {
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
