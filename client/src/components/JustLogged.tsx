import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { Stars } from './Stars'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { SECTION_META, fmtDate } from '../lib/format'
import type { MediaType } from '../lib/types'

export interface LoggedThing {
  workId: number
  entryId?: number | null
  title: string
  type: MediaType
  /** The date it went in with, so the field starts where the entry is. */
  consumedOn?: string | null
}

/**
 * The moment just after something is added.
 *
 * Adding from a list is one tap and the thing is already in the library —
 * that part should never be held up by a form. But the two things most worth
 * recording are a rating and when you actually got to it, and neither is
 * likely to be revisited if you have to go and find the title again. So they
 * are offered here, already saved either way, and dismissing this changes
 * nothing.
 */
export function JustLogged({ thing, onClose }: { thing: LoggedThing; onClose: () => void }) {
  const meta = SECTION_META[thing.type]
  const navigate = useNavigate()
  const { toast, refresh } = useApp()

  const [rating, setRating] = useState<number | null>(null)
  const [date, setDate] = useState(thing.consumedOn || new Date().toISOString().slice(0, 10))
  const [noDate, setNoDate] = useState(!thing.consumedOn)
  const [saving, setSaving] = useState(false)

  async function save(then?: 'details') {
    setSaving(true)
    try {
      // Nothing to send if neither was touched; closing is not a failure.
      if (rating != null || !noDate) {
        await api.patch(`/entries/${thing.entryId}`, {
          ...(rating != null ? { rating } : {}),
          consumed_on: noDate ? null : date,
        })
        void refresh()
      }
      if (then === 'details') navigate(`/work/${thing.workId}`)
      onClose()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally { setSaving(false) }
  }

  return (
    <Modal
      title={
        <span className="u-row" style={{ gap: 8 }}>
          <Icon name="check" size={16} /> {meta.verb} {thing.title}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Not now</button>
          <button className="btn" disabled={saving} onClick={() => save('details')}>
            More details <Icon name="chevronRight" size={13} />
          </button>
          <button className="btn btn--primary" disabled={saving} onClick={() => save()}>
            {saving ? 'Saving…' : 'Done'}
          </button>
        </>
      }
    >
      <div className="sheet__body">
        <p className="u-sm u-mut" style={{ margin: 0 }}>
          It is in your library already. Add a rating or a date if you want to — or just close this.
        </p>

        <div className="field">
          <label>Your rating</label>
          <Stars value={rating} size={30} onChange={setRating} showValue />
        </div>

        <div className="field">
          <label htmlFor="jl-date">When</label>
          <div className="u-row u-wrap" style={{ gap: 8 }}>
            <input
              id="jl-date"
              className="input"
              type="date"
              value={date}
              disabled={noDate}
              style={{ width: 170, opacity: noDate ? 0.5 : 1 }}
              onChange={(e) => { setDate(e.target.value); setNoDate(false) }}
            />
            <button
              className={`chip${!noDate && date === new Date().toISOString().slice(0, 10) ? ' is-on' : ''}`}
              onClick={() => { setNoDate(false); setDate(new Date().toISOString().slice(0, 10)) }}
            >
              Today
            </button>
            <button className={`chip${noDate ? ' is-on' : ''}`} onClick={() => setNoDate((v) => !v)}>
              <Icon name="clock" size={13} /> Not sure
            </button>
          </div>
          {!noDate && <span className="field__hint">{fmtDate(date)}</span>}
        </div>
      </div>
    </Modal>
  )
}
