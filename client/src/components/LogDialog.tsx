import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { Stars } from './Stars'
import { Icon } from './Icon'
import { artworkUrl } from '../lib/img'
import { PosterArt } from './Poster'
import { api, qs } from '../lib/api'
import { useApp } from '../lib/store'
import { SECTION_META, TYPE_ORDER, creatorLine } from '../lib/format'
import type { MediaType, ProviderHit } from '../lib/types'

const todayIso = () => new Date().toISOString().slice(0, 10)

type Mode = 'log' | 'want'

/** A search hit, whether it came from your library or a metadata provider. */
interface Hit extends ProviderHit {
  id?: number
  inLibrary?: boolean
}

/**
 * The one place anything is added. Search first — by name, across every media
 * type — then say whether you have consumed it or want to. The fields below
 * change to match, and the media type comes from whatever you picked.
 */
export function LogDialog() {
  const { logTarget, closeLog, toast, refresh } = useApp()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('log')
  const [typeFilter, setTypeFilter] = useState<MediaType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<Hit | null>(null)
  const [manualType, setManualType] = useState<MediaType>('film')
  const [byHand, setByHand] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  // log fields
  const [rating, setRating] = useState<number | null>(null)
  const [date, setDate] = useState(todayIso())
  const [noDate, setNoDate] = useState(false)
  const [status, setStatus] = useState('completed')
  const [review, setReview] = useState('')
  const [repeat, setRepeat] = useState(false)
  const [liked, setLiked] = useState(false)
  const [progress, setProgress] = useState('')

  // watchlist fields
  const [recommender, setRecommender] = useState('')
  const [note, setNote] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [priority, setPriority] = useState(1)

  const existingWork = logTarget?.kind === 'work' ? logTarget.work : null

  useEffect(() => {
    if (!logTarget) return
    setMode(logTarget.kind === 'blank' && logTarget.mode === 'want' ? 'want' : 'log')
    setRating(null); setDate(todayIso()); setNoDate(false); setStatus('completed')
    setReview(''); setRepeat(false); setLiked(false); setProgress('')
    setRecommender(''); setNote(''); setSourceUrl(''); setPriority(1)
    setHits([]); setQuery(''); setByHand(false)

    if (logTarget.kind === 'work') {
      setChosen(null)
      setTypeFilter(logTarget.work.type)
      setManualType(logTarget.work.type)
      setRepeat(logTarget.work.entries.length > 0)
    } else if (logTarget.kind === 'hit') {
      setChosen(logTarget.hit as Hit)
      setTypeFilter(logTarget.hit.type)
      setManualType(logTarget.hit.type)
    } else {
      setChosen(null)
      setTypeFilter(logTarget.type ?? 'all')
      setManualType(logTarget.type ?? 'film')
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [logTarget])

  // Type-ahead across every media type unless you narrow it deliberately.
  useEffect(() => {
    if (!logTarget || logTarget.kind !== 'blank' || chosen) return
    const q = query.trim()
    if (q.length < 2) { setHits([]); setSearching(false); return }
    const mine = ++seq.current
    setSearching(true)
    const t = setTimeout(async () => {
      const scope = { q, type: typeFilter === 'all' ? null : typeFilter }
      const shape = (res: { local: any[]; remote?: ProviderHit[] }) => [
        ...res.local.map((l) => ({ ...l, provider: 'library', inLibrary: true, overview: null, genres: l.genres || [] })),
        ...(res.remote ?? []),
      ].slice(0, 12) as Hit[]
      try {
        const quick = await api.get<{ local: any[] }>(`/search${qs({ ...scope, remote: 0 })}`)
        if (seq.current === mine) setHits(shape(quick))
      } catch { /* keep going */ }
      if (seq.current !== mine) return
      try {
        const res = await api.get<{ remote: ProviderHit[]; local: any[] }>(`/search${qs(scope)}`)
        if (seq.current === mine) setHits(shape(res))
      } catch { /* leave the quick results in place */ } finally {
        if (seq.current === mine) setSearching(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query, typeFilter, logTarget, chosen])

  const target = useMemo(() => {
    if (byHand && query.trim()) {
      return {
        title: query.trim(), year: null, poster_url: null,
        type: manualType, creators: [], genres: [],
      }
    }
    if (existingWork) {
      return {
        title: existingWork.title, year: existingWork.year, poster_url: existingWork.poster_url,
        type: existingWork.type, creators: existingWork.creators, genres: existingWork.genres,
      }
    }
    if (chosen) {
      return {
        title: chosen.title, year: chosen.year, poster_url: chosen.poster_url,
        type: chosen.type, creators: chosen.creators, genres: chosen.genres,
      }
    }
    return null
  }, [existingWork, chosen, byHand, query, manualType])

  if (!logTarget) return null

  const effectiveType: MediaType = target?.type ?? manualType
  const meta = SECTION_META[effectiveType]
  const canSubmit = Boolean(target)

  function workPayload() {
    if (chosen && !chosen.inLibrary) {
      return {
        type: chosen.type, title: chosen.title, year: chosen.year, creators: chosen.creators,
        genres: chosen.genres, overview: chosen.overview, poster_url: chosen.poster_url,
        runtime: chosen.runtime, pages: chosen.pages, tmdb_id: chosen.tmdb_id, imdb_id: chosen.imdb_id,
        isbn: chosen.isbn, olid: chosen.olid, itunes_id: chosen.itunes_id, mbid: chosen.mbid,
        metadata: chosen.metadata,
      }
    }
    return { type: manualType, title: query.trim() }
  }

  async function save() {
    if (!canSubmit) { toast('Search for something first', 'error'); return }
    setSaving(true)
    try {
      if (mode === 'want') {
        await api.post('/recs', {
          title: target?.title ?? query.trim(),
          type: effectiveType,
          year: target?.year ?? null,
          creators: target?.creators ?? [],
          poster_url: target?.poster_url ?? null,
          recommender: recommender.trim() || null,
          note: note.trim() || null,
          source_url: sourceUrl.trim() || null,
          priority,
          enrichNow: !target?.poster_url,
        })
        toast(`${target?.title ?? query.trim()} added to your list`)
        closeLog()
        await refresh()
        navigate('/inbox')
        return
      }

      const payload: Record<string, unknown> = {
        rating,
        consumed_on: noDate ? null : date,
        review: review.trim() || null,
        is_repeat: repeat,
        liked,
        status,
        progress: progress.trim() || null,
      }
      if (existingWork) payload.work_id = existingWork.id
      else if (chosen?.inLibrary && chosen.id) payload.work_id = chosen.id
      else payload.work = workPayload()

      const res = await api.post<{ work: { id: number; title: string } }>('/log', payload)
      toast(`Logged ${res.work.title}`)
      closeLog()
      await refresh()
      if (!existingWork) navigate(`/work/${res.work.id}`)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const submitLabel = saving
    ? 'Saving…'
    : !target
      ? 'Pick something first'
      : mode === 'want'
        ? 'Add to my list'
        : `Log as ${meta.verb.toLowerCase()}`

  return (
    <Modal
      title={
        <span className="u-row" style={{ gap: 8 }}>
          <Icon name={mode === 'want' ? 'inbox' : 'plus'} size={16} />
          {target ? target.title : mode === 'want' ? 'Something to check out' : 'Log something'}
        </span>
      }
      onClose={closeLog}
      footer={
        <>
          <button className="btn btn--ghost" onClick={closeLog}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={saving || !canSubmit}>{submitLabel}</button>
        </>
      }
    >
      <div className="sheet__body">
        {/* What am I doing with this? Everything below follows from the answer. */}
        <div className="modeswitch" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'log'}
            className={mode === 'log' ? 'is-on' : ''}
            onClick={() => setMode('log')}
          >
            <Icon name="check" size={14} />
            <span>I’ve {meta.verb.toLowerCase()} it</span>
          </button>
          <button
            role="tab"
            aria-selected={mode === 'want'}
            className={mode === 'want' ? 'is-on' : ''}
            onClick={() => setMode('want')}
          >
            <Icon name="inbox" size={14} />
            <span>Want to</span>
          </button>
        </div>

        {!target && (
          <>
            <div className="field">
              <label htmlFor="log-q">Search by name</label>
              <div className="toolbar__search" style={{ height: 42 }}>
                <Icon name="search" size={16} className="u-mut" />
                <input
                  id="log-q"
                  ref={inputRef}
                  className="toolbar__input"
                  style={{ fontSize: 15 }}
                  placeholder="Start typing a film, show, book, album…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
                {searching && <span className="spinner" aria-label="Searching" />}
              </div>
              <span className="field__hint">
                {typeFilter === 'all'
                  ? 'Searching films, TV, books, audiobooks and music at once.'
                  : `Searching ${SECTION_META[typeFilter].label.toLowerCase()} only.`}
              </span>
            </div>

            {hits.length > 0 && (
              <div className="hitlist">
                {hits.map((hit, i) => (
                  <button key={i} className="hit" onClick={() => setChosen(hit)}>
                    <span className="hit__art">
                      <PosterArt
                        src={artworkUrl(hit.poster_url)}
                        title={hit.title}
                        type={hit.type}
                        aspect={SECTION_META[hit.type].aspect}
                      />
                    </span>
                    <span className="u-col u-grow" style={{ gap: 3, minWidth: 0 }}>
                      <span className="u-row u-wrap" style={{ gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 580 }}>{hit.title}</span>
                        {hit.year && <span className="u-xs u-mut u-tnum">{hit.year}</span>}
                      </span>
                      <span className="u-row u-wrap" style={{ gap: 6 }}>
                        <span className="pill" style={{ color: SECTION_META[hit.type].hue }}>
                          {SECTION_META[hit.type].singular}
                        </span>
                        {hit.inLibrary && <span className="pill pill--good">in your library</span>}
                        {hit.external_rating ? <span className="u-xs u-mut u-tnum">{hit.external_rating.toFixed(1)}</span> : null}
                      </span>
                      {creatorLine(hit.creators, 2) && (
                        <span className="u-xs u-mut u-trunc">{creatorLine(hit.creators, 2)}</span>
                      )}
                      {hit.genres?.length ? (
                        <span className="u-xs u-mut u-trunc">{hit.genres.slice(0, 3).join(' · ')}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {query.trim().length >= 2 && !searching && hits.length === 0 && (
              <div className="u-col" style={{ gap: 9 }}>
                <p className="u-sm u-mut" style={{ margin: 0 }}>
                  Nothing found for “{query.trim()}”. Add it by hand instead?
                </p>
                <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setByHand(true)}>
                  <Icon name="plus" size={14} /> Add “{query.trim()}” as a {meta.singular.toLowerCase()}
                </button>
              </div>
            )}

            <div className="field">
              <label>{hits.length || query ? 'Narrow the search, or say what it is' : 'Media type'}</label>
              <div className="chiprow">
                <button className={`chip${typeFilter === 'all' ? ' is-on' : ''}`} onClick={() => setTypeFilter('all')}>
                  Everything
                </button>
                {TYPE_ORDER.map((t) => (
                  <button
                    key={t}
                    className={`chip${typeFilter === t ? ' is-on' : ''}`}
                    onClick={() => { setTypeFilter(t); setManualType(t) }}
                  >
                    {SECTION_META[t].label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {target && (
          <div className="chosen">
            <div style={{ width: 76, flex: '0 0 auto' }}>
              <PosterArt src={target.poster_url} title={target.title} type={target.type} aspect={SECTION_META[target.type].aspect} />
            </div>
            <div className="u-col u-grow" style={{ gap: 4, minWidth: 0 }}>
              <strong style={{ fontSize: 15.5, letterSpacing: '-0.015em' }}>{target.title}</strong>
              <span className="u-row u-wrap" style={{ gap: 6 }}>
                <span className="pill" style={{ color: SECTION_META[target.type].hue }}>{SECTION_META[target.type].singular}</span>
                {target.year && <span className="u-xs u-mut u-tnum">{target.year}</span>}
              </span>
              {creatorLine(target.creators, 2) && <span className="u-sm u-mut u-trunc">{creatorLine(target.creators, 2)}</span>}
              {!existingWork && (
                <button className="btn btn--sm btn--ghost" style={{ alignSelf: 'flex-start', marginTop: 2 }} onClick={() => { setChosen(null); setByHand(false) }}>
                  <Icon name="refresh" size={13} /> Pick something else
                </button>
              )}
            </div>
          </div>
        )}

        {target && mode === 'log' ? (
          <>
            <div className="u-row u-wrap" style={{ gap: 18 }}>
              <div className="field" style={{ flex: '0 0 auto' }}>
                <label>Your rating</label>
                <Stars value={rating} size={26} onChange={setRating} showValue />
              </div>
              <div className="field" style={{ flex: '0 0 auto' }}>
                <label htmlFor="log-date">Date</label>
                <input
                  id="log-date"
                  className="input"
                  type="date"
                  value={date}
                  disabled={noDate}
                  style={{ width: 160, opacity: noDate ? 0.5 : 1 }}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: '0 0 auto' }}>
                <label htmlFor="log-status">Status</label>
                <div className="selectwrap">
                  <select id="log-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }}>
                    <option value="completed">Finished</option>
                    <option value="in_progress">In progress</option>
                    <option value="abandoned">Gave up</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="chiprow">
              <button className={`chip${noDate ? ' is-on' : ''}`} onClick={() => setNoDate((v) => !v)}>
                <Icon name="clock" size={13} /> Date unknown
              </button>
              <button className={`chip${repeat ? ' is-on' : ''}`} onClick={() => setRepeat((v) => !v)}>
                <Icon name="repeat" size={13} /> {effectiveType === 'book' || effectiveType === 'audiobook' ? 'Reread' : 'Rewatch'}
              </button>
              <button className={`chip${liked ? ' is-on' : ''}`} onClick={() => setLiked((v) => !v)}>
                <Icon name="heart" size={13} /> Liked
              </button>
            </div>

            {status === 'in_progress' && (
              <div className="field">
                <label htmlFor="log-progress">How far in?</label>
                <input id="log-progress" className="input" placeholder="S02E04 · p.218 · 62%" value={progress} onChange={(e) => setProgress(e.target.value)} />
              </div>
            )}

            <div className="field">
              <label htmlFor="log-review">Notes or review <span className="u-mut">(optional)</span></label>
              <textarea id="log-review" className="textarea" placeholder="What stayed with you?" value={review} onChange={(e) => setReview(e.target.value)} />
            </div>
          </>
        ) : target ? (
          <>
            <div className="field">
              <label htmlFor="rec-who">Who or where it came from</label>
              <input
                id="rec-who"
                className="input"
                value={recommender}
                onChange={(e) => setRecommender(e.target.value)}
                placeholder="Sam at work · the Blindboy podcast · a review"
              />
            </div>
            <div className="field">
              <label htmlFor="rec-note">Why <span className="u-mut">(worth remembering)</span></label>
              <textarea
                id="rec-note"
                className="textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="“Like Arrival but weirder”"
              />
            </div>
            <div className="field">
              <label htmlFor="rec-url">Link <span className="u-mut">(optional)</span></label>
              <input id="rec-url" className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div className="chiprow">
              <button className={`chip${priority === 2 ? ' is-on' : ''}`} onClick={() => setPriority(priority === 2 ? 1 : 2)}>
                <Icon name="star" size={13} /> Priority — get to this soon
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
