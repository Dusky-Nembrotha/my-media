import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { api } from '../lib/api'
import { useApp, useFetch } from '../lib/store'
import { fmtDate } from '../lib/format'

interface Season {
  number: number
  name: string
  episodes: number | null
  year: number | null
  air_date: string | null
  watched: boolean
  entry_id: number | null
  consumed_on: string | null
  rating: number | null
}

/**
 * Which seasons of a show you have watched.
 *
 * A series is not one thing you either saw or did not — people watch three
 * seasons and stop, or come back years later for the new one. Ticking a
 * season logs it, dated to when it aired, which is near enough for a show
 * watched at the time and far better than no date at all.
 */
export function Seasons({ workId, onChanged }: { workId: number; onChanged: () => void }) {
  const { toast } = useApp()
  const { data, reload } = useFetch<{ known: boolean; unspecified: number; seasons: Season[] }>(
    `/works/${workId}/seasons`, [workId],
  )
  const [picked, setPicked] = useState<Set<number> | null>(null)
  const [saving, setSaving] = useState(false)

  // Start from what is already logged, then follow the user.
  useEffect(() => {
    if (!data) return
    setPicked(new Set(data.seasons.filter((s) => s.watched).map((s) => s.number)))
  }, [data])

  const seasons = data?.seasons ?? []
  if (!seasons.length) return null

  const current = picked ?? new Set(seasons.filter((s) => s.watched).map((s) => s.number))
  const saved = new Set(seasons.filter((s) => s.watched).map((s) => s.number))
  const dirty = current.size !== saved.size || [...current].some((n) => !saved.has(n))

  const toggle = (n: number) => setPicked(() => {
    const next = new Set(current)
    if (next.has(n)) next.delete(n)
    else next.add(n)
    return next
  })

  async function save() {
    setSaving(true)
    try {
      const res = await api.post<{ added: number; removed: number; keptBecauseRated: number }>(
        `/works/${workId}/seasons`, { seasons: [...current] },
      )
      const bits = [
        res.added ? `${res.added} added` : null,
        res.removed ? `${res.removed} removed` : null,
        res.keptBecauseRated ? `${res.keptBecauseRated} kept because rated` : null,
      ].filter(Boolean)
      toast(bits.length ? `Seasons updated — ${bits.join(', ')}` : 'Nothing to change')
      reload()
      onChanged()
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="card">
      <div className="u-spread" style={{ marginBottom: 10 }}>
        <span className="u-caps">Seasons watched</span>
        <span className="u-xs u-mut u-tnum">{current.size} of {seasons.length}</span>
      </div>

      <div className="seasonlist">
        {seasons.map((s) => {
          const on = current.has(s.number)
          return (
            <button
              key={s.number}
              className={`seasonpill${on ? ' is-on' : ''}`}
              onClick={() => toggle(s.number)}
              title={[
                s.episodes ? `${s.episodes} episodes` : null,
                s.air_date ? `first aired ${fmtDate(s.air_date)}` : null,
                s.rating != null ? `you rated it ${s.rating}★` : null,
              ].filter(Boolean).join(' · ')}
            >
              <span className="seasonpill__tick">
                {on ? <Icon name="check" size={12} /> : null}
              </span>
              <span className="u-grow">{s.name}</span>
              {s.rating != null && <span className="u-xs u-tnum" style={{ color: 'var(--star)' }}>{s.rating}★</span>}
              {s.year && <span className="u-xs u-mut u-tnum">{s.year}</span>}
            </button>
          )
        })}
      </div>

      {data?.unspecified ? (
        <p className="u-xs u-mut" style={{ margin: '10px 0 0' }}>
          {data.unspecified} {data.unspecified === 1 ? 'entry does' : 'entries do'} not say which season.
        </p>
      ) : null}

      {!data?.known && (
        <p className="u-xs u-mut" style={{ margin: '10px 0 0' }}>
          Only the seasons already logged are listed — the metadata sources do not know this show.
        </p>
      )}

      {dirty && (
        <div className="u-row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn--sm btn--primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save seasons'}
          </button>
          <button className="btn btn--sm btn--ghost" onClick={() => setPicked(new Set(saved))} disabled={saving}>
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
