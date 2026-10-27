import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Stars } from '../components/Stars'
import { PosterArt, PosterCard } from '../components/Poster'
import { Row } from '../components/Row'
import { Modal } from '../components/Modal'
import { api } from '../lib/api'
import { coverColours } from '../lib/coverColour'
import { artworkUrl } from '../lib/img'
import { ArtworkPicker } from '../components/ArtworkPicker'
import { useApp, useFetch } from '../lib/store'
import { SECTION_META, fmtDate, fmtRuntime, relDate, statusLabel } from '../lib/format'
import type { Entry, Work, WorkCard } from '../lib/types'

export function WorkPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { openLog, toast, refresh } = useApp()
  const { data, loading, reload, setData } = useFetch<{ work: Work; related: WorkCard[] }>(id ? `/works/${id}` : null, [id])
  const [editing, setEditing] = useState<Entry | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The hero takes its colour from the artwork it is sitting behind.
  const [tint, setTint] = useState<{ base: string; accent: string } | null>(null)
  const [pickingArt, setPickingArt] = useState(false)
  const poster = data?.work?.poster_url ?? null

  useEffect(() => {
    setTint(null)
    if (!poster) return
    let live = true
    void coverColours(artworkUrl(poster) || poster).then((c) => { if (live && c) setTint(c) })
    return () => { live = false }
  }, [poster])

  if (loading) {
    return (
      <div className="page page--flush">
        <div className="skel" style={{ height: 320, borderRadius: 0 }} />
        <div style={{ padding: '20px var(--gutter)' }}>
          <div className="skel" style={{ height: 26, width: 280 }} />
        </div>
      </div>
    )
  }
  if (!data) return <div className="page"><p className="u-mut">Could not load that title.</p></div>

  const { work, related } = data
  const meta = SECTION_META[work.type]
  const latest = work.entries[0]
  const cast = work.creators.filter((c) => c.role === 'Cast')
  const makers = work.creators.filter((c) => c.role !== 'Cast')
  const links = buildLinks(work)

  async function rate(entryId: number, rating: number | null) {
    try {
      const updated = await api.patch<Work>(`/entries/${entryId}`, { rating })
      setData({ work: updated, related })
      toast(rating == null ? 'Rating cleared' : `Rated ${rating}★`)
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
  }

  async function removeEntry(entryId: number) {
    try {
      await api.del(`/entries/${entryId}`)
      toast('Entry removed')
      reload()
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
  }

  async function refreshMetadata() {
    try {
      await api.post(`/works/${work.id}/refresh`)
      toast('Looking it up again — reload in a moment', 'info')
      setTimeout(reload, 4000)
    } catch (err) { toast((err as Error).message, 'error') }
  }

  async function removeWork() {
    try {
      await api.del(`/works/${work.id}`)
      toast(`${work.title} removed from your library`)
      void refresh()
      navigate(meta.path)
    } catch (err) { toast((err as Error).message, 'error') }
  }

  return (
    <div
      className={`page page--flush workpage${tint ? ' is-tinted' : ''}`}
      style={tint ? ({ ['--cover-base' as string]: tint.base, ['--cover-accent' as string]: tint.accent }) : undefined}
    >
      <div
        className="workpanel"
        style={tint ? ({ ['--cover-base' as string]: tint.base, ['--cover-accent' as string]: tint.accent }) : undefined}
      >
      <Link to={meta.path} className="workclose" aria-label={`Back to ${meta.label}`} title={`Back to ${meta.label}`}>
        <Icon name="x" size={18} />
      </Link>
      <div className={`workhero${tint ? ' is-tinted' : ''}`}>
        <div className="workhero__bg" style={{ backgroundImage: work.backdrop_url || work.poster_url ? `url(${artworkUrl(work.backdrop_url || work.poster_url)})` : undefined }} />
        <div className="workhero__scrim" />
        <div className="workhero__inner">
          <div className="workhero__poster">
            <PosterArt src={work.poster_url} title={work.title} type={work.type} aspect={meta.aspect} />
            <button className="btn btn--sm changeart" onClick={() => setPickingArt(true)}>
              <Icon name="pencil" size={12} /> Change cover
            </button>
          </div>
          <div className="workhero__body">
            <div className="u-row u-wrap" style={{ gap: 8 }}>
              <Link to={meta.path} className="pill pill--accent">{meta.label}</Link>
              {work.stats.status && statusLabel(work.stats.status, work.type) && (
                <span className="pill pill--warn">{statusLabel(work.stats.status, work.type)}</span>
              )}
              {work.entries.length > 1 && <span className="pill">{work.entries.length} entries</span>}
            </div>
            <h1>{work.title}</h1>
            <div className="u-row u-wrap u-sm u-dim" style={{ gap: 10 }}>
              {work.year && <span className="u-tnum">{work.year}</span>}
              {work.runtime ? <span>{fmtRuntime(work.runtime)}</span> : null}
              {work.pages ? <span>{work.pages} pages</span> : null}
              {work.seasons ? <span>{work.seasons} season{work.seasons === 1 ? '' : 's'}</span> : null}
              {work.language && <span style={{ textTransform: 'uppercase' }}>{work.language}</span>}
            </div>
            {makers.length > 0 && (
              <div className="u-sm" style={{ marginTop: 2 }}>
                {groupRoles(makers).map((g) => (
                  <div key={g.role} className="u-row" style={{ gap: 6, alignItems: 'baseline' }}>
                    <span className="u-xs u-mut" style={{ minWidth: 72 }}>{g.role}</span>
                    <span className="u-grow">
                      {g.names.map((n, i) => (
                        <span key={n}>
                          {i > 0 && <span className="u-mut">, </span>}
                          <Link to={`${meta.path}?creator=${encodeURIComponent(n)}`} className="linkish">{n}</Link>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <PublicRatings workId={work.id} />

            <div className="workhero__rate">
              <div className="u-col" style={{ gap: 5 }}>
                <span className="u-caps">Your rating</span>
                {latest
                  ? <Stars value={latest.rating} size={30} onChange={(r) => rate(latest.id, r)} showValue />
                  : <span className="u-sm u-mut">Not logged yet</span>}
                {latest && (
                  <span className="u-row u-xs u-mut" style={{ gap: 7 }}>
                    <span>
                      {meta.verb} {latest.consumed_on ? fmtDate(latest.consumed_on) : 'at some point'}
                      {work.entries.length > 1 ? ` · ${work.entries.length} times` : ''}
                    </span>
                    <button className="linkish" onClick={() => setEditing(latest)}>edit</button>
                  </span>
                )}
              </div>
              <div className="u-row u-wrap" style={{ gap: 8 }}>
                <button className="btn btn--primary" onClick={() => openLog({ kind: 'work', work })}>
                  <Icon name="plus" size={15} /> {work.entries.length ? `${meta.verb} again` : `${meta.verb} it`}
                </button>

                {links.map((l) => (
                  <a key={l.label} className="btn btn--ghost" href={l.href} target="_blank" rel="noreferrer">
                    {l.label} <Icon name="external" size={13} />
                  </a>
                ))}
                <button className="btn btn--ghost btn--sm" onClick={refreshMetadata} title="Wrong artwork or details? Look it up again">
                  <Icon name="refresh" size={14} />
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(true)} title="Remove from library">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="workbody">
        <div className="workbody__main">
          {work.overview && (
            <section className="card card--pad-lg">
              <div className="u-caps" style={{ marginBottom: 8 }}>Synopsis</div>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: 'var(--ink-2)' }}>{work.overview}</p>
            </section>
          )}

          <SeriesRow workId={work.id} />

          {related.length > 0 && (
            <Row title="More like this in your library" cardWidth={140}>
              {related.map((w) => <PosterCard key={w.id} work={w} aspect={SECTION_META[w.type].aspect} />)}
            </Row>
          )}
        </div>

        <aside className="workbody__side">
          <WhereToWatch workId={work.id} type={work.type} />
          <div className="card">
            <div className="u-caps" style={{ marginBottom: 10 }}>Details</div>
            <dl className="deflist">
              {work.genres.length > 0 && (
                <>
                  <dt>Genres</dt>
                  <dd className="chiprow">
                    {work.genres.map((g) => (
                      <Link key={g} to={`${meta.path}?genre=${encodeURIComponent(g)}`} className="chip">{g}</Link>
                    ))}
                  </dd>
                </>
              )}
              {work.release_date && (<><dt>Released</dt><dd>{fmtDate(work.release_date)}</dd></>)}
              {work.stats.last && (<><dt>Last {meta.verb.toLowerCase()}</dt><dd>{relDate(work.stats.last)}</dd></>)}
              {work.metadata?.narrators?.length ? (<><dt>Narrator</dt><dd>{work.metadata.narrators.join(', ')}</dd></>) : null}
              {work.metadata?.series ? (<><dt>Series</dt><dd>{work.metadata.series}</dd></>) : null}
              {work.metadata?.play_count ? (<><dt>Plays</dt><dd className="u-tnum">{work.metadata.play_count}</dd></>) : null}
              {work.metadata?.provider ? (<><dt>Metadata</dt><dd style={{ textTransform: 'capitalize' }}>{work.metadata.provider}</dd></>) : null}
            </dl>
          </div>

          {cast.length > 0 && (
            <div className="card">
              <div className="u-caps" style={{ marginBottom: 10 }}>Cast</div>
              <div className="u-col" style={{ gap: 6 }}>
                {cast.slice(0, 8).map((c) => <span key={c.name} className="u-sm u-dim">{c.name}</span>)}
              </div>
            </div>
          )}

          {work.lists.length > 0 && (
            <div className="card">
              <div className="u-caps" style={{ marginBottom: 10 }}>On your lists</div>
              <div className="chiprow">
                {/* Lists have no page of their own at the moment, so these name
                    the list rather than pretending to link somewhere. */}
                {work.lists.map((l) => <span key={l.id} className="chip">{l.name}</span>)}
              </div>
            </div>
          )}
        </aside>
      </div>
      </div>

      {editing && (
        <EntryEditor
          entry={editing}
          type={work.type}
          releaseDate={work.release_date || (work.year ? `${work.year}-01-01` : null)}
          onClose={() => setEditing(null)}
          onSaved={(updated) => { setData({ work: updated, related }); setEditing(null); void refresh() }}
          onDelete={() => { void removeEntry(editing.id); setEditing(null) }}
        />
      )}

      {pickingArt && (
        <ArtworkPicker
          workId={work.id}
          onClose={() => setPickingArt(false)}
          onChosen={() => reload()}
        />
      )}

      {confirmDelete && (
        <Modal
          title="Remove from library?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
              <button className="btn btn--danger" onClick={removeWork}>Remove {work.title}</button>
            </>
          }
        >
          <div className="sheet__body">
            <p className="u-sm u-dim" style={{ margin: 0 }}>
              This deletes <strong>{work.title}</strong> and its {work.entries.length} log
              entr{work.entries.length === 1 ? 'y' : 'ies'}. Re-importing the original export would bring it back.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}

function EntryEditor({ entry, type, releaseDate, onClose, onSaved, onDelete }: {
  entry: Entry
  type: Work['type']
  releaseDate?: string | null
  onClose: () => void
  onSaved: (work: Work) => void
  onDelete: () => void
}) {
  const { toast } = useApp()
  const [rating, setRating] = useState(entry.rating)
  const [date, setDate] = useState(entry.consumed_on || '')
  const [review, setReview] = useState(entry.review || '')
  const [status, setStatus] = useState(entry.status)
  const [progress, setProgress] = useState(entry.progress || '')
  const [repeat, setRepeat] = useState(entry.is_repeat)
  const [liked, setLiked] = useState(entry.liked)
  const [format, setFormat] = useState<string>(entry.format || 'book')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const updated = await api.patch<Work>(`/entries/${entry.id}`, {
        rating, consumed_on: date || null, review: review.trim() || null,
        status, progress: progress.trim() || null, is_repeat: repeat, liked,
        format: type === 'book' ? format : null,
      })
      toast('Entry updated')
      onSaved(updated)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally { setSaving(false) }
  }

  return (
    <Modal
      title="Edit entry"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--danger" onClick={onDelete}>Delete this entry</button>
          <span className="u-grow" />
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div className="sheet__body">
        <div className="u-row u-wrap" style={{ gap: 18 }}>
          <div className="field" style={{ flex: '0 0 auto' }}>
            <label>Rating</label>
            <Stars value={rating} size={26} onChange={setRating} showValue />
          </div>
          <div className="field" style={{ flex: '0 0 auto' }}>
            <label htmlFor="e-date">Date</label>
            <div className="u-row" style={{ gap: 6 }}>
              <input id="e-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
              {releaseDate && (
                <button
                  className={`chip${date === releaseDate ? ' is-on' : ''}`}
                  onClick={() => setDate(releaseDate)}
                  title={`Set the date to the release date, ${fmtDate(releaseDate)}`}
                >
                  <Icon name="calendar" size={13} /> On release
                </button>
              )}
            </div>
          </div>
          <div className="field" style={{ flex: '0 0 auto' }}>
            <label htmlFor="e-status">Status</label>
            <div className="selectwrap">
              <select id="e-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }}>
                <option value="completed">Finished</option>
                <option value="in_progress">In progress</option>
                <option value="abandoned">Gave up</option>
                <option value="planned">Planned</option>
              </select>
            </div>
          </div>
        </div>
        <div className="chiprow">
          {type === 'book' && ([['book', 'Read'], ['audiobook', 'Listened'], ['both', 'Both']] as const).map(([v, label]) => (
            <button key={v} className={`chip${format === v ? ' is-on' : ''}`} onClick={() => setFormat(v)}>
              <Icon name={v === 'audiobook' ? 'headphones' : 'book'} size={13} /> {label}
            </button>
          ))}
          <button className={`chip${repeat ? ' is-on' : ''}`} onClick={() => setRepeat((v) => !v)}>
            <Icon name="repeat" size={13} /> {type === 'book' || type === 'audiobook' ? 'Reread' : 'Rewatch'}
          </button>
          <button className={`chip${liked ? ' is-on' : ''}`} onClick={() => setLiked((v) => !v)}>
            <Icon name="heart" size={13} /> Liked
          </button>
        </div>
        <div className="field">
          <label htmlFor="e-progress">Progress</label>
          <input id="e-progress" className="input" value={progress} onChange={(e) => setProgress(e.target.value)} placeholder="S02E04 · p.218 · 3 plays" />
        </div>
        <div className="field">
          <label htmlFor="e-review">Review</label>
          <textarea id="e-review" className="textarea" value={review} onChange={(e) => setReview(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

function groupRoles(creators: { role?: string; name: string }[]) {
  const map = new Map<string, string[]>()
  for (const c of creators) {
    const role = c.role || 'Credits'
    const list = map.get(role) || []
    if (!list.includes(c.name)) list.push(c.name)
    map.set(role, list)
  }
  return [...map.entries()].slice(0, 4).map(([role, names]) => ({ role, names: names.slice(0, 4) }))
}

function buildLinks(work: Work) {
  const out: { label: string; href: string }[] = []
  if (work.imdb_id) out.push({ label: 'IMDb', href: `https://www.imdb.com/title/${work.imdb_id}/` })
  if (work.tmdb_id) out.push({ label: 'TMDB', href: `https://www.themoviedb.org/${work.type === 'tv' ? 'tv' : 'movie'}/${work.tmdb_id}` })
  if (work.metadata?.letterboxd_uri) out.push({ label: 'Letterboxd', href: work.metadata.letterboxd_uri })
  if (work.metadata?.goodreads_url) out.push({ label: 'Goodreads', href: work.metadata.goodreads_url })
  if (work.metadata?.audible_url) out.push({ label: 'Audible', href: work.metadata.audible_url })
  if (work.metadata?.itunes_url) out.push({ label: 'Apple', href: work.metadata.itunes_url })
  if (work.metadata?.wikipedia) out.push({ label: 'Wikipedia', href: work.metadata.wikipedia })
  if (work.isbn && !out.length) out.push({ label: 'Open Library', href: `https://openlibrary.org/isbn/${work.isbn}` })
  return out.slice(0, 3)
}


/**
 * Streaming availability. The data is JustWatch's, reached through TMDB, who
 * license it — which is why JustWatch is credited and linked here.
 */
function WhereToWatch({ workId, type }: { workId: number; type: Work['type'] }) {
  const enabled = type === 'film' || type === 'tv'
  const { data, loading } = useFetch<any>(enabled ? `/works/${workId}/watch` : null, [workId])

  if (!enabled || loading || !data?.available) return null
  const groups = [
    ['Streaming', data.stream],
    ['Free', data.free],
    ['Rent', data.rent],
    ['Buy', data.buy],
  ].filter(([, list]) => (list as any[])?.length) as [string, any[]][]

  if (!groups.length) {
    return (
      <div className="card">
        <div className="u-caps" style={{ marginBottom: 8 }}>Where to watch</div>
        <p className="u-xs u-mut" style={{ margin: 0 }}>
          Nothing streaming in {data.region} right now.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="u-spread" style={{ marginBottom: 10 }}>
        <span className="u-caps">Where to watch</span>
        <span className="u-xs u-mut">{data.region}</span>
      </div>
      <div className="u-col" style={{ gap: 12 }}>
        {groups.map(([label, list]) => (
          <div key={label} className="u-col" style={{ gap: 6 }}>
            <span className="u-xs u-mut">{label}</span>
            <div className="providers">
              {list.slice(0, 6).map((p: any) => (
                <span key={p.name} className="provider" title={p.name}>
                  {p.logo
                    ? <img src={p.logo} alt={p.name} loading="lazy" />
                    : <span className="provider__text">{p.name}</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {data.link && (
        <a className="btn btn--sm btn--ghost" style={{ marginTop: 12 }} href={data.link} target="_blank" rel="noreferrer">
          Open on JustWatch <Icon name="external" size={12} />
        </a>
      )}
      <p className="u-xs u-mut" style={{ margin: '10px 0 0' }}>
        Availability from JustWatch, via TMDB.
      </p>
    </div>
  )
}


/**
 * What everybody else made of it. The scores come from whichever sources suit
 * the medium, each shown on its own scale — a Rotten Tomatoes percentage is
 * not a mark out of ten and is not drawn as one.
 */
function PublicRatings({ workId }: { workId: number }) {
  const { data } = useFetch<{
    ratings: { source: string; score: number | null; scale: number; display: string | null; votes?: number | null; url: string | null }[]
    needsOmdbKey?: boolean
  }>(`/works/${workId}/ratings`, [workId])

  const scored = (data?.ratings ?? []).filter((r) => r.display)
  const links = (data?.ratings ?? []).filter((r) => !r.display && r.url)
  if (!scored.length && !links.length) return null

  return (
    <div className="pubratings">
      {scored.map((r) => {
        const body = (
          <>
            <span className="pubratings__score u-tnum">{r.display}</span>
            <span className="pubratings__src">{r.source}</span>
            {r.votes ? <span className="pubratings__votes u-tnum">{compact(r.votes)}</span> : null}
          </>
        )
        return r.url
          ? <a key={r.source} className="pubrating" href={r.url} target="_blank" rel="noreferrer">{body}</a>
          : <span key={r.source} className="pubrating">{body}</span>
      })}
      {links.map((r) => (
        <a key={r.source} className="pubrating pubrating--link" href={r.url!} target="_blank" rel="noreferrer">
          <span className="pubratings__src">{r.source}</span>
          <Icon name="external" size={11} />
        </a>
      ))}
      {data?.needsOmdbKey && (
        <Link to="/settings" className="pubrating pubrating--link" title="IMDb and Rotten Tomatoes need a free OMDb key">
          <span className="pubratings__src">Add IMDb &amp; RT</span>
          <Icon name="key" size={11} />
        </Link>
      )}
    </div>
  )
}

/** 1,284,221 → 1.3M, so a vote count never pushes the row out of shape. */
function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}


interface SeriesPart {
  type: Work['type']
  title: string
  year: number | null
  ordinal?: number | null
  poster_url: string | null
  creators: { role?: string; name: string }[]
  work_id: number | null
  inLibrary: boolean
  isThisOne: boolean
}

/**
 * The rest of the series or franchise, in order.
 *
 * Things you already have link straight through; things you do not can be
 * added where they stand, which is the whole point — finding the second Dune
 * film should not mean going back to search and typing it out.
 */
function SeriesRow({ workId }: { workId: number }) {
  const { toast, refresh } = useApp()
  const { data } = useFetch<{ name: string | null; parts: SeriesPart[] }>(`/works/${workId}/series`, [workId])
  const [added, setAdded] = useState<Record<string, true>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const parts = data?.parts ?? []
  if (!data?.name || parts.length < 2) return null

  async function add(part: SeriesPart) {
    setBusy(part.title)
    try {
      await api.post('/recs', {
        type: part.type, title: part.title, year: part.year,
        creators: part.creators, poster_url: part.poster_url,
      })
      toast(`${part.title} added to ${SECTION_META[part.type].planned.toLowerCase()}`)
      setAdded((a) => ({ ...a, [part.title]: true }))
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setBusy(null) }
  }

  return (
    <Row title={`More in ${data.name}`} subtitle={`${parts.length} in the series`} cardWidth={140}>
      {parts.map((part) => {
        const meta = SECTION_META[part.type]
        const label = part.ordinal ? `${part.ordinal}. ${part.title}` : part.title
        if (part.work_id) {
          return (
            <Link
              key={part.title}
              to={`/work/${part.work_id}`}
              className={`poster${part.isThisOne ? ' is-current' : ''}`}
              title={part.isThisOne ? `${part.title} — the one you are looking at` : part.title}
            >
              <PosterArt src={part.poster_url} title={part.title} type={part.type} aspect={meta.aspect} />
              <div className="poster__meta">
                <div className="poster__title">{label}</div>
                <div className="poster__sub u-trunc">{part.isThisOne ? 'This one' : (part.year ?? 'In your library')}</div>
              </div>
            </Link>
          )
        }
        return (
          <div key={part.title} className="poster">
            <PosterArt src={part.poster_url} title={part.title} type={part.type} aspect={meta.aspect} />
            <div className="poster__meta">
              <div className="poster__title">{label}</div>
              {added[part.title] ? (
                <div className="poster__sub u-trunc">On your list</div>
              ) : (
                <button
                  className="linkish u-xs"
                  disabled={busy === part.title}
                  onClick={() => add(part)}
                >
                  + {meta.planned}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </Row>
  )
}
