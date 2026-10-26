import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Empty } from '../components/Modal'
import { api } from '../lib/api'
import { useApp, useFetch } from '../lib/store'
import { SECTION_META, fmtNumber, relDate } from '../lib/format'
import type { MediaType } from '../lib/types'

interface Candidate {
  id: string
  label: string
  confidence: number
  reason?: string
  filesUsed?: string[]
  total?: number
  options?: { key: string; label: string; type: string; default: any }[]
  preview?: {
    total: number
    byType: Record<string, number>
    samples: { type: MediaType; title: string; year: number | null; rating: number | null; consumed_on: string | null; kind: string; creators?: string[] }[]
    listsTouched?: string[]
  }
  error?: string
}

interface Analysis {
  token: string
  files: { filename: string; headers: string[] | null; rows: number | null; kind: string; bytes: number }[]
  detected: string
  candidates: Candidate[]
}

export function ImportPage() {
  const { toast, refresh } = useApp()
  const sources = useFetch<{ sources: { id: string; label: string; accepts: string[]; help: string }[]; sampleAvailable: boolean }>('/import/sources')
  const runs = useFetch<{ runs: any[]; enrich: any }>('/import/runs')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [options, setOptions] = useState<Record<string, any>>({})
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [enrich, setEnrich] = useState<any>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // While metadata is being filled in, show live progress.
  useEffect(() => {
    let timer: number | undefined
    const poll = async () => {
      try {
        const s = await api.get<any>('/enrich/status')
        setEnrich(s)
        if (s.pending > 0) timer = window.setTimeout(poll, 1500)
      } catch { /* ignore */ }
    }
    void poll()
    return () => { if (timer) clearTimeout(timer) }
  }, [result])

  async function analyse(files: FileList | File[]) {
    const form = new FormData()
    for (const f of Array.from(files)) form.append('files', f)
    setBusy(true)
    setResult(null)
    try {
      const res = await api.upload<Analysis>('/import/analyse', form)
      setAnalysis(res)
      setChosen(res.detected)
      const cand = res.candidates.find((c) => c.id === res.detected)
      const opts: Record<string, any> = {}
      for (const o of cand?.options ?? []) opts[o.key] = o.default
      setOptions(opts)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally { setBusy(false) }
  }

  async function runImport() {
    if (!analysis || !chosen) return
    setBusy(true)
    try {
      const res = await api.post<any>('/import/apply', { token: analysis.token, source: chosen, options })
      setResult(res.summary)
      setAnalysis(null)
      toast(`Imported ${res.summary.entriesAdded} entries`)
      runs.reload()
      void refresh()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally { setBusy(false) }
  }

  async function loadSamples() {
    setBusy(true)
    try {
      const res = await api.post<any>('/import/samples')
      toast(`Sample library loaded — ${res.queuedForEnrichment} titles queued for artwork`)
      setResult({
        total: res.summaries.reduce((a: number, s: any) => a + s.total, 0),
        worksAdded: res.summaries.reduce((a: number, s: any) => a + s.worksAdded, 0),
        entriesAdded: res.summaries.reduce((a: number, s: any) => a + s.entriesAdded, 0),
        entriesSkipped: res.summaries.reduce((a: number, s: any) => a + s.entriesSkipped, 0),
        recsAdded: res.summaries.reduce((a: number, s: any) => a + s.recsAdded, 0),
        byType: res.summaries.reduce((acc: any, s: any) => {
          for (const [k, v] of Object.entries(s.byType || {})) acc[k] = (acc[k] || 0) + (v as number)
          return acc
        }, {}),
        samples: res.summaries.flatMap((s: any) => s.samples || []).slice(0, 12),
      })
      runs.reload()
      void refresh()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally { setBusy(false) }
  }

  const candidate = analysis?.candidates.find((c) => c.id === chosen)

  return (
    <div className="page">
      {!analysis && !result && (
        <>
          <div
            className={`dropzone${dragging ? ' is-dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) void analyse(e.dataTransfer.files) }}
            onClick={() => fileInput.current?.click()}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".csv,.tsv,.json,.zip,.txt"
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files?.length) void analyse(e.target.files) }}
            />
            <span className="dropzone__icon"><Icon name="upload" size={30} /></span>
            <h2>Drop your exports here</h2>
            <p className="u-dim">
              Whole ZIPs are fine — Letterboxd and Spotify ship dozens of files and the right ones are
              picked out automatically. CSV, TSV and JSON too. Nothing leaves this machine.
            </p>
            <div className="u-row u-wrap" style={{ gap: 8, justifyContent: 'center' }}>
              <span className="btn btn--primary">{busy ? 'Reading…' : 'Choose files'}</span>
              {sources.data?.sampleAvailable && (
                <button
                  className="btn"
                  onClick={(e) => { e.stopPropagation(); void loadSamples() }}
                  disabled={busy}
                >
                  <Icon name="sparkle" size={15} /> Load a sample library
                </button>
              )}
            </div>
          </div>

          <section style={{ marginTop: 34 }}>
            <div className="section-head">
              <div>
                <h2>What you can bring in</h2>
                <p>Each one is auto-detected — you never have to say which is which</p>
              </div>
            </div>
            <div className="sourcegrid">
              {(sources.data?.sources ?? []).map((s) => (
                <div key={s.id} className="card sourcecard">
                  <div className="u-spread">
                    <strong style={{ fontSize: 14 }}>{s.label}</strong>
                    <span className="u-xs u-mut">{s.accepts.join(' ')}</span>
                  </div>
                  <p className="u-xs u-mut" style={{ margin: 0, lineHeight: 1.55 }}>{s.help}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {analysis && (
        <div className="u-col" style={{ gap: 18 }}>
          <div className="u-spread">
            <div>
              <h1 style={{ fontSize: 22 }}>Ready to import</h1>
              <p className="u-sm u-mut">
                {analysis.files.length} file{analysis.files.length === 1 ? '' : 's'} read ·
                {' '}{analysis.files.filter((f) => f.rows).reduce((a, f) => a + (f.rows || 0), 0).toLocaleString('en-GB')} rows
              </p>
            </div>
            <button className="btn btn--ghost" onClick={() => { setAnalysis(null); setChosen(null) }}>Start over</button>
          </div>

          <div className="card">
            <div className="u-caps" style={{ marginBottom: 10 }}>Which service is this?</div>
            <div className="u-col" style={{ gap: 8 }}>
              {analysis.candidates.map((c) => (
                <label key={c.id} className={`pickrow${chosen === c.id ? ' is-on' : ''}`}>
                  <input
                    type="radio"
                    name="source"
                    checked={chosen === c.id}
                    onChange={() => {
                      setChosen(c.id)
                      const opts: Record<string, any> = {}
                      for (const o of c.options ?? []) opts[o.key] = o.default
                      setOptions(opts)
                    }}
                  />
                  <span className="u-col u-grow" style={{ gap: 3, minWidth: 0 }}>
                    <span className="u-row" style={{ gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>{c.label}</strong>
                      <span className="pill">{Math.round(c.confidence * 100)}% match</span>
                      {c.total ? <span className="u-xs u-mut">{fmtNumber(c.total)} records</span> : null}
                    </span>
                    <span className="u-xs u-mut">{c.error ? `Could not parse: ${c.error}` : c.reason}</span>
                    {c.preview?.byType && (
                      <span className="chiprow" style={{ marginTop: 3 }}>
                        {Object.entries(c.preview.byType).map(([t, n]) => (
                          <span key={t} className="chip chip--static">
                            {SECTION_META[t as MediaType]?.label ?? t} · {n as number}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {candidate?.options?.length ? (
            <div className="card">
              <div className="u-caps" style={{ marginBottom: 10 }}>Options</div>
              <div className="u-col" style={{ gap: 12 }}>
                {candidate.options.map((o) => (
                  <div key={o.key} className="u-spread">
                    <label className="u-sm" htmlFor={`opt-${o.key}`}>{o.label}</label>
                    {o.type === 'boolean' ? (
                      <button
                        id={`opt-${o.key}`}
                        className={`switch${options[o.key] ? ' is-on' : ''}`}
                        onClick={() => setOptions((s) => ({ ...s, [o.key]: !s[o.key] }))}
                        aria-pressed={Boolean(options[o.key])}
                      />
                    ) : (
                      <input
                        id={`opt-${o.key}`}
                        className="input"
                        style={{ width: 90 }}
                        type="number"
                        value={options[o.key] ?? o.default}
                        onChange={(e) => setOptions((s) => ({ ...s, [o.key]: Number(e.target.value) }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {candidate?.preview?.samples?.length ? (
            <div className="card">
              <div className="u-caps" style={{ marginBottom: 10 }}>Preview</div>
              <div className="tablewrap">
                <table className="dtable">
                  <thead><tr><th>Title</th><th>Type</th><th>Year</th><th>Rating</th><th>Date</th><th>Goes to</th></tr></thead>
                  <tbody>
                    {candidate.preview.samples.slice(0, 10).map((s, i) => (
                      <tr key={i}>
                        <td>{s.title}</td>
                        <td>{SECTION_META[s.type]?.label ?? s.type}</td>
                        <td className="u-tnum">{s.year ?? '—'}</td>
                        <td className="u-tnum">{s.rating ?? '—'}</td>
                        <td className="u-tnum">{s.consumed_on ?? '—'}</td>
                        <td>{s.kind === 'rec' ? 'To check out' : s.kind === 'list' ? 'A list' : 'Your log'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {candidate.filesUsed?.length ? (
                <p className="u-xs u-mut" style={{ margin: '10px 0 0' }}>
                  Reading: {candidate.filesUsed.slice(0, 6).join(', ')}{candidate.filesUsed.length > 6 ? ` +${candidate.filesUsed.length - 6} more` : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="u-row" style={{ gap: 10 }}>
            <button className="btn btn--primary btn--lg" onClick={runImport} disabled={busy || !chosen}>
              {busy ? 'Importing…' : `Import ${fmtNumber(candidate?.total ?? 0)} records`}
            </button>
            <span className="u-xs u-mut">
              Re-importing the same export later is safe — entries are matched, not duplicated.
            </span>
          </div>
        </div>
      )}

      {result && (
        <div className="u-col" style={{ gap: 18 }}>
          <div className="resultcard">
            <span className="resultcard__tick"><Icon name="check" size={26} /></span>
            <div className="u-col u-grow" style={{ gap: 4 }}>
              <h2>Import complete</h2>
              <p className="u-sm u-dim" style={{ margin: 0 }}>
                {fmtNumber(result.entriesAdded)} new entries · {fmtNumber(result.worksAdded)} new titles ·
                {' '}{fmtNumber(result.recsAdded)} added to your list · {fmtNumber(result.entriesSkipped)} already known
              </p>
              {result.byType && (
                <span className="chiprow" style={{ marginTop: 6 }}>
                  {Object.entries(result.byType).map(([t, n]) => (
                    <Link key={t} to={SECTION_META[t as MediaType]?.path ?? '/'} className="chip">
                      {SECTION_META[t as MediaType]?.label ?? t} · {n as number}
                    </Link>
                  ))}
                </span>
              )}
            </div>
            <button className="btn" onClick={() => { setResult(null); setAnalysis(null) }}>Import something else</button>
          </div>

          {enrich && enrich.pending > 0 && (
            <div className="card">
              <div className="u-spread" style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>Fetching artwork and metadata</strong>
                <span className="u-xs u-mut u-tnum">{enrich.pending} to go</span>
              </div>
              <div className="progress">
                <div
                  className="progress__bar"
                  style={{ width: `${Math.round((enrich.done / Math.max(1, enrich.done + enrich.pending)) * 100)}%` }}
                />
              </div>
              <p className="u-xs u-mut" style={{ margin: '8px 0 0' }}>
                One title at a time so the free metadata services stay happy
                {enrich.lastTitle ? ` — currently ${enrich.lastTitle}` : ''}. You can carry on using the app.
              </p>
            </div>
          )}
        </div>
      )}

      {runs.data?.runs?.length ? (
        <section style={{ marginTop: 36 }}>
          <div className="section-head">
            <div><h2>Import history</h2></div>
            {enrich && enrich.missingArtwork > 0 && (
              <button
                className="btn btn--sm"
                onClick={async () => { await api.post('/enrich', {}); toast('Metadata refresh queued', 'info') }}
              >
                <Icon name="refresh" size={14} /> Fill {enrich.missingArtwork} missing artwork
              </button>
            )}
          </div>
          <div className="card" style={{ padding: 6 }}>
            {runs.data.runs.map((r: any) => (
              <div key={r.id} className="actrow">
                <span className="u-col u-grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="u-row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 13.5, textTransform: 'capitalize' }}>{r.source}</strong>
                    <span className={`pill${r.status === 'done' ? ' pill--good' : r.status === 'failed' ? ' pill--warn' : ''}`}>{r.status}</span>
                  </span>
                  <span className="u-xs u-mut u-trunc">{r.filename || '—'}</span>
                </span>
                <span className="u-xs u-mut u-tnum">
                  +{r.entries_added} entries · +{r.works_added} titles{r.recs_added ? ` · +${r.recs_added} to check out` : ''}
                </span>
                <span className="u-xs u-mut">{relDate(String(r.started_at).slice(0, 10))}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!analysis && !result && !sources.data?.sources?.length && (
        <Empty icon="import" title="Loading importers…" />
      )}
    </div>
  )
}
