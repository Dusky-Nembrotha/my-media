import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { api } from '../lib/api'
import { useApp, useFetch } from '../lib/store'
import { SECTION_META, relDate } from '../lib/format'
import type { MediaType } from '../lib/types'

interface Field { key: string; label: string; secret?: boolean; help?: string; default?: string }
interface Option { key: string; label: string; type: string; default: any }

interface LiveService {
  id: string
  label: string
  mediaTypes: MediaType[]
  kind: 'oauth-device' | 'oauth-code' | 'api-key'
  capabilities: string[]
  website: string
  blurb: string
  fields: Field[]
  instructions: string[]
  options: Option[]
  state: {
    status: 'disconnected' | 'pending' | 'connected' | 'error'
    account: string | null
    config: Record<string, string>
    hasCredentials: boolean
    pending: any
    last_sync_at: string | null
    last_result: Record<string, number>
    message: string | null
  }
}

interface OtherService {
  id: string
  label: string
  mediaTypes: MediaType[]
  kind: string
  website: string
  blurb: string
  instructions?: string[]
  alternative?: string
  connected?: boolean
  settingKey?: string
}


// Known endings only, so filenames like Audible.Library.csv are left alone.
const TLD = '(?:com|org|net|io|tv|fm|app|dev|ai|me|gg|co\\.uk|co)'
const URL_RE = new RegExp(`((?:https?://)?(?:[a-z0-9-]+\\.)+${TLD}(?:/[^\\s,)]*)?)`, 'gi')

/** Turns the addresses inside an instruction into links you can just click. */
function linkify(text: string) {
  const parts = String(text).split(URL_RE)
  return parts.map((part, i) => {
    if (i % 2 === 0 || !part) return part
    const trimmed = part.replace(/[.,;:]+$/, '')
    const tail = part.slice(trimmed.length)
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    return (
      <span key={i}>
        <a className="steplink" href={href} target="_blank" rel="noreferrer">{trimmed}</a>
        {tail}
      </span>
    )
  })
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="steps">
      {steps.map((step, i) => <li key={i}>{linkify(step)}</li>)}
    </ol>
  )
}

const GROUPS: { title: string; types: MediaType[] }[] = [
  { title: 'Films & TV', types: ['film', 'tv'] },
  { title: 'Books & audiobooks', types: ['book', 'audiobook'] },
  { title: 'Music & podcasts', types: ['album', 'track', 'podcast'] },
  { title: 'Games', types: ['game'] },
]

const KIND_LABEL: Record<string, string> = {
  'oauth-device': 'Live sync · sign in',
  'oauth-code': 'Live sync · sign in',
  'api-key': 'Live sync · API key',
  file: 'Import a file',
  'metadata-key': 'Metadata · API key',
  'metadata-free': 'Metadata · no key needed',
}

export function ConnectionsPage() {
  const { data, loading, reload } = useFetch<{ live: LiveService[]; fileOnly: OtherService[]; metadata: OtherService[] }>('/connections')
  const [filter, setFilter] = useState<string>('all')

  if (loading && !data) {
    return <div className="page"><div className="skel" style={{ height: 160 }} /></div>
  }

  const groups = GROUPS.map((g) => ({
    ...g,
    live: (data?.live ?? []).filter((s) => s.mediaTypes.some((t) => g.types.includes(t))),
    files: (data?.fileOnly ?? []).filter((s) => s.mediaTypes.some((t) => g.types.includes(t))),
    meta: (data?.metadata ?? []).filter((s) => s.mediaTypes.some((t) => g.types.includes(t))),
  })).filter((g) => g.live.length || g.files.length || g.meta.length)

  const connectedCount = (data?.live ?? []).filter((s) => s.state.status === 'connected').length

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <h1 style={{ fontSize: 24 }}>Connections</h1>
          <p>
            {connectedCount
              ? `${connectedCount} service${connectedCount === 1 ? '' : 's'} connected.`
              : 'Nothing connected yet.'}
            {' '}Live services sync on demand; everything else imports from a file.
          </p>
        </div>
        <Link className="btn" to="/import"><Icon name="import" size={15} /> Import a file</Link>
      </div>

      <div className="filterbar" style={{ marginTop: 0 }}>
        <div className="chiprow u-grow scrollrow">
          {['all', 'live', 'files', 'metadata'].map((f) => (
            <button key={f} className={`chip${filter === f ? ' is-on' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Everything' : f === 'live' ? 'Live sync' : f === 'files' ? 'File imports' : 'Metadata'}
            </button>
          ))}
        </div>
      </div>

      {groups.map((group) => (
        <section key={group.title} style={{ marginBottom: 34 }}>
          <div className="connhead">
            <h2>{group.title}</h2>
            <span className="connhead__types">
              {group.types.map((t) => (
                <span key={t} className="pill" style={{ color: SECTION_META[t].hue }}>{SECTION_META[t].label}</span>
              ))}
            </span>
          </div>

          <div className="conngrid">
            {(filter === 'all' || filter === 'live') && group.live.map((s) => (
              <LiveCard key={s.id} service={s} onChange={reload} />
            ))}
            {(filter === 'all' || filter === 'files') && group.files.map((s) => (
              <OtherCard key={s.id} service={s} />
            ))}
            {(filter === 'all' || filter === 'metadata') && group.meta.map((s) => (
              <OtherCard key={s.id} service={s} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function LiveCard({ service, onChange }: { service: LiveService; onChange: () => void }) {
  const { toast, refresh } = useApp()
  const s = service.state
  const [open, setOpen] = useState(s.status !== 'connected' && !s.hasCredentials)
  const [values, setValues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<any>(null)
  const [pasteCode, setPasteCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const pollTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current) }, [])

  async function saveConfig() {
    setBusy('save')
    try {
      await api.put(`/connections/${service.id}/config`, values)
      toast(`${service.label} details saved`)
      setValues({})
      onChange()
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  async function connect() {
    setBusy('connect')
    try {
      const res = await api.post<any>(`/connections/${service.id}/begin`)
      if (res.done) {
        toast(`${service.label} connected`)
        onChange()
        return
      }
      setPending(res.pending)
      if (res.pending?.mode === 'device') startPolling()
      if (res.pending?.mode === 'redirect' && res.pending.authorize_url) {
        window.open(res.pending.authorize_url, '_blank', 'noopener')
      }
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  function startPolling() {
    const tick = async () => {
      try {
        const res = await api.post<any>(`/connections/${service.id}/poll`)
        if (res.status === 'connected') {
          toast(`${service.label} connected`)
          setPending(null)
          onChange()
          return
        }
        if (res.status === 'error') {
          toast(res.message || 'Could not connect', 'error')
          setPending(null)
          onChange()
          return
        }
        pollTimer.current = window.setTimeout(tick, 5000)
      } catch {
        pollTimer.current = window.setTimeout(tick, 8000)
      }
    }
    pollTimer.current = window.setTimeout(tick, 5000)
  }

  async function exchange() {
    setBusy('exchange')
    try {
      await api.post(`/connections/${service.id}/exchange`, { code: pasteCode.trim() })
      toast(`${service.label} connected`)
      setPending(null)
      setPasteCode('')
      onChange()
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  async function sync() {
    setBusy('sync')
    try {
      const res = await api.post<any>(`/connections/${service.id}/sync`, {})
      const sum = res.summary
      toast(`${service.label}: ${sum.entriesAdded} new, ${sum.entriesUpdated} updated, ${sum.recsAdded} to check out`)
      onChange()
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  async function disconnect() {
    setBusy('disconnect')
    try {
      await api.post(`/connections/${service.id}/disconnect`, {})
      toast(`${service.label} disconnected`)
      setPending(null)
      onChange()
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(null) }
  }

  const connected = s.status === 'connected'

  return (
    <article className={`conncard${connected ? ' is-connected' : ''}`}>
      <div className="conncard__head">
        <div className="u-col u-grow" style={{ gap: 4, minWidth: 0 }}>
          <div className="u-row u-wrap" style={{ gap: 8 }}>
            <strong style={{ fontSize: 15 }}>{service.label}</strong>
            <span className={`pill${connected ? ' pill--good' : ''}`}>{KIND_LABEL[service.kind]}</span>
          </div>
          <span className="u-xs u-mut">
            {connected
              ? `Connected${s.account ? ` as ${s.account}` : ''}${s.last_sync_at ? ` · synced ${relDate(s.last_sync_at.slice(0, 10))}` : ' · never synced'}`
              : service.capabilities.join(' · ')}
          </span>
        </div>
        <span className={`conndot${connected ? ' is-on' : s.status === 'error' ? ' is-bad' : ''}`} />
      </div>

      <p className="u-xs u-mut" style={{ margin: 0, lineHeight: 1.55 }}>{service.blurb}</p>

      {s.message && <p className="u-xs" style={{ margin: 0, color: 'var(--bad)' }}>{s.message}</p>}

      {connected && s.last_result?.total != null && (
        <span className="u-xs u-mut">
          Last sync: {s.last_result.entriesAdded ?? 0} added · {s.last_result.entriesUpdated ?? 0} updated
          {s.last_result.recsAdded ? ` · ${s.last_result.recsAdded} to check out` : ''}
        </span>
      )}

      {pending?.mode === 'device' && (
        <div className="connpending">
          <span className="u-xs u-mut">Open this and enter the code — then come back here, it finishes by itself.</span>
          <a className="btn btn--sm" href={pending.verification_url} target="_blank" rel="noreferrer">
            {pending.verification_url} <Icon name="external" size={12} />
          </a>
          <span className="devicecode">{pending.user_code}</span>
          <span className="u-row" style={{ gap: 6 }}><span className="spinner" /> <span className="u-xs u-mut">Waiting for you to approve…</span></span>
        </div>
      )}

      {pending?.mode === 'redirect' && (
        <div className="connpending">
          <span className="u-xs u-mut">{pending.instruction}</span>
          <a className="btn btn--sm" href={pending.authorize_url} target="_blank" rel="noreferrer">
            Open {service.label} <Icon name="external" size={12} />
          </a>
          <div className="u-row" style={{ gap: 6 }}>
            <input
              className="input"
              placeholder="Paste the address you were sent to"
              value={pasteCode}
              onChange={(e) => setPasteCode(e.target.value)}
            />
            <button className="btn btn--sm btn--primary" disabled={!pasteCode.trim() || busy === 'exchange'} onClick={exchange}>
              Finish
            </button>
          </div>
        </div>
      )}

      <div className="u-row u-wrap" style={{ gap: 7, marginTop: 'auto' }}>
        {connected ? (
          <>
            <button className="btn btn--sm btn--primary" onClick={sync} disabled={busy === 'sync'}>
              <Icon name="refresh" size={13} /> {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn btn--sm btn--ghost" onClick={disconnect} disabled={busy === 'disconnect'}>Disconnect</button>
          </>
        ) : (
          <button className="btn btn--sm btn--primary" onClick={connect} disabled={busy === 'connect' || !s.hasCredentials}>
            <Icon name="key" size={13} /> {busy === 'connect' ? 'Starting…' : 'Connect'}
          </button>
        )}
        <button className="btn btn--sm btn--ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide setup' : s.hasCredentials ? 'Edit details' : 'Set up'}
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
        </button>
        <a className="btn btn--sm btn--ghost" href={service.website} target="_blank" rel="noreferrer">
          <Icon name="external" size={13} />
        </a>
      </div>

      {open && (
        <div className="connsetup">
          <Steps steps={service.instructions} />
          <div className="u-col" style={{ gap: 10 }}>
            {service.fields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`${service.id}-${f.key}`}>{f.label}</label>
                <input
                  id={`${service.id}-${f.key}`}
                  className="input"
                  type={f.secret ? 'password' : 'text'}
                  placeholder={s.config[f.key] || f.default || ''}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  autoComplete="off"
                />
                {f.help && <span className="field__hint">{f.help}</span>}
              </div>
            ))}
            <button className="btn btn--sm" onClick={saveConfig} disabled={busy === 'save' || !Object.keys(values).length}>
              {busy === 'save' ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

function OtherCard({ service }: { service: OtherService }) {
  const [open, setOpen] = useState(false)
  const isMetadata = service.kind.startsWith('metadata')
  return (
    <article className={`conncard${isMetadata && service.connected ? ' is-connected' : ''}`}>
      <div className="conncard__head">
        <div className="u-col u-grow" style={{ gap: 4, minWidth: 0 }}>
          <div className="u-row u-wrap" style={{ gap: 8 }}>
            <strong style={{ fontSize: 15 }}>{service.label}</strong>
            <span className={`pill${isMetadata && service.connected ? ' pill--good' : ''}`}>{KIND_LABEL[service.kind] ?? service.kind}</span>
          </div>
          {isMetadata && (
            <span className="u-xs u-mut">
              {service.settingKey ? (service.connected ? 'Key saved' : 'Optional — add a key in Settings') : 'Always on'}
            </span>
          )}
        </div>
        {isMetadata && <span className={`conndot${service.connected ? ' is-on' : ''}`} />}
      </div>

      <p className="u-xs u-mut" style={{ margin: 0, lineHeight: 1.55 }}>{linkify(service.blurb)}</p>
      {service.alternative && (
        <p className="u-xs" style={{ margin: 0, color: 'var(--ink-3)' }}>
          <Icon name="sparkle" size={11} /> {service.alternative}
        </p>
      )}

      <div className="u-row u-wrap" style={{ gap: 7, marginTop: 'auto' }}>
        {service.instructions?.length ? (
          <button className="btn btn--sm btn--ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide steps' : 'How to get your data'}
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
          </button>
        ) : null}
        {service.settingKey && (
          <Link className="btn btn--sm" to="/settings"><Icon name="key" size={13} /> Add key</Link>
        )}
        {service.kind === 'file' && (
          <Link className="btn btn--sm" to="/import"><Icon name="import" size={13} /> Import</Link>
        )}
        <a className="btn btn--sm btn--ghost" href={service.website} target="_blank" rel="noreferrer">
          <Icon name="external" size={13} />
        </a>
      </div>

      {open && service.instructions?.length ? (
        <div className="connsetup">
          <Steps steps={service.instructions} />
        </div>
      ) : null}
    </article>
  )
}
