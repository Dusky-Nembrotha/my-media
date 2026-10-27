import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { Stars } from './Stars'
import { ArtworkPicker } from './ArtworkPicker'
import { Icon } from './Icon'
import { artworkUrl } from '../lib/img'
import { PosterArt } from './Poster'
import { api, qs } from '../lib/api'
import { useApp } from '../lib/store'
import { SECTION_META, TYPE_ORDER, creatorLine, fmtDate } from '../lib/format'
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
  // Which query the results in `hits` belong to. Without this, an empty list
  // left over from a previous keystroke reads as "nothing found" for whatever
  // is in the box now — which is how a perfectly good search looked broken.
  const [hitsFor, setHitsFor] = useState('')
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<Hit | null>(null)
  const [manualType, setManualType] = useState<MediaType>('film')
  const [byHand, setByHand] = useState(false)
  const [saving, setSaving] = useState(false)
  // A cover chosen here, overriding whatever the provider picked.
  const [cover, setCover] = useState<string | null>(null)
  const [pickingArt, setPickingArt] = useState(false)
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
  // Read it, listened to it, or some of each. Only books are asked.
  const [format, setFormat] = useState<'book' | 'audiobook' | 'both'>('book')

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
    setReview(''); setRepeat(false); setLiked(false); setProgress(''); setFormat('book')
    setRecommender(''); setNote(''); setSourceUrl(''); setPriority(1)
    setHits([]); setHitsFor(''); setByHand(false); setCover(null); setPickingArt(false)
    // Clear the box only when there is nothing in it worth keeping: the focus
    // call below is async, so a fast typist can start before this lands.
    setQuery((q) => (logTarget.kind === 'blank' ? '' : q))

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
    if (q.length < 2) { setHits([]); setHitsFor(''); setSearching(false); return }
    const mine = ++seq.current
    setSearching(true)
    const t = setTimeout(async () => {
      const scope = { q, type: typeFilter === 'all' ? null : typeFilter }
      const shape = (res: { local: any[]; remote?: ProviderHit[] }) => [
        ...res.local.map((l) => ({ ...l, provider: 'library', inLibrary: true, overview: null, genres: l.genres || [] })),
        ...(res.remote ?? []),
      ].slice(0, 12) as Hit[]
      // The local pass is instant and paints first; the providers follow.
      try {
        const quick = await api.get<{ local: any[] }>(`/search${qs({ ...scope, remote: 0 })}`)
        if (seq.current === mine && quick.local.length) {
          setHits(shape(quick))
          setHitsFor(q)
        }
      } catch { /* keep going */ }
      if (seq.current !== mine) return
      try {
        const res = await api.get<{ remote: ProviderHit[]; local: any[] }>(`/search${qs(scope)}`)
        if (seq.current === mine) {
          setHits(shape(res))
          setHitsFor(q)
        }
      } catch {
        // Leave whatever the local pass found, but do not claim we looked
        // everywhere and found nothing.
        if (seq.current === mine) setHitsFor('')
      } finally {
        if (seq.current === mine) setSearching(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query, typeFilter, logTarget, chosen])

  const target = useMemo(() => {
    if (byHand && query.trim()) {
      return {
        title: query.trim(), year: null, release_date: null, poster_url: null,
        type: manualType, creators: [], genres: [],
      }
    }
    if (existingWork) {
      return {
        title: existingWork.title, year: existingWork.year,
        release_date: existingWork.release_date ?? null, poster_url: existingWork.poster_url,
        type: existingWork.type, creators: existingWork.creators, genres: existingWork.genres,
      }
    }
    if (chosen) {
      return {
        title: chosen.title, year: chosen.year,
        release_date: chosen.release_date ?? null, poster_url: chosen.poster_url,
        type: chosen.type, creators: chosen.creators, genres: chosen.genres,
      }
    }
    return null
  }, [existingWork, chosen, byHand, query, manualType])

  /*
   * "I saw it when it came out" is a common thing to want to record, and far
   * quicker to tap than to scroll a date picker back thirty years.
   *
   * A full release date is used as-is. Where only the year is known — Open
   * Library gives a first-publish year and nothing more — the chip says so and
   * uses the 1st of January, which is the honest reading of "sometime in 1987".
   */
  const releaseDate = useMemo(() => {
    const raw = target?.release_date
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return { iso: raw, label: fmtDate(raw) || raw, exact: true }
    }
    const year = target?.year
    if (year && year > 1800 && year <= new Date().getFullYear() + 1) {
      return { iso: `${year}-01-01`, label: String(year), exact: false }
    }
    return null
  }, [target])

  if (!logTarget) return null

  const effectiveType: MediaType = target?.type ?? manualType
  const meta = SECTION_META[effectiveType]
  const canSubmit = Boolean(target)

  function workPayload() {
    if (chosen && !chosen.inLibrary) {
      return {
        type: chosen.type, title: chosen.title, year: chosen.year, creators: chosen.creators,
        genres: chosen.genres, overview: chosen.overview, poster_url: cover ?? chosen.poster_url,
        runtime: chosen.runtime, pages: chosen.pages, tmdb_id: chosen.tmdb_id, imdb_id: chosen.imdb_id,
        isbn: chosen.isbn, olid: chosen.olid, itunes_id: chosen.itunes_id, mbid: chosen.mbid,
        metadata: chosen.metadata,
      }
    }
    return { type: manualType, title: query.trim(), poster_url: cover ?? null }
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
          poster_url: cover ?? target?.poster_url ?? null,
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
        format: effectiveType === 'book' ? format : null,
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
        : `${meta.verb} it`

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
      {pickingArt && target && (
        <ArtworkPicker
          workId={existingWork?.id ?? (chosen?.inLibrary ? chosen.id : undefined)}
          unsaved={existingWork || chosen?.inLibrary ? undefined : {
            type: target.type,
            title: target.title,
            creator: target.creators?.[0]?.name ?? null,
            tmdb_id: chosen?.tmdb_id ?? null,
            mbid: chosen?.mbid ?? null,
          }}
          onClose={() => setPickingArt(false)}
          onChosen={(poster) => setCover(poster)}
        />
      )}

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
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {searching && <span className="spinner" aria-label="Searching" />}
              </div>
              <span className="field__hint">
                {typeFilter === 'all'
                  ? 'Searching films, TV, books and music at once.'
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

            {query.trim().length >= 2 && !searching && hits.length === 0 && hitsFor === query.trim() && (
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
              <button
                className="btn btn--sm btn--ghost"
                style={{ alignSelf: 'flex-start', marginTop: 2 }}
                onClick={() => setPickingArt(true)}
              >
                <Icon name="pencil" size={13} /> Change cover
              </button>
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
              {releaseDate && (
                <button
                  className={`chip${!noDate && date === releaseDate.iso ? ' is-on' : ''}`}
                  onClick={() => { setNoDate(false); setDate(releaseDate.iso) }}
                  title={`Set the date to ${releaseDate.label}`}
                >
                  <Icon name="calendar" size={13} /> {releaseDate.exact ? 'On release' : 'Release year'} · {releaseDate.label}
                </button>
              )}
              <button className={`chip${noDate ? ' is-on' : ''}`} onClick={() => setNoDate((v) => !v)}>
                <Icon name="clock" size={13} /> Date unknown
              </button>
              <button
                className={`chip${!noDate && date === todayIso() ? ' is-on' : ''}`}
                onClick={() => { setNoDate(false); setDate(todayIso()) }}
              >
                <Icon name="check" size={13} /> Today
              </button>
              {effectiveType === 'book' && (
                <span className="formatpick">
                  {([['book', 'Read'], ['audiobook', 'Listened'], ['both', 'Both']] as const).map(([v, label]) => (
                    <button
                      key={v}
                      className={`chip${format === v ? ' is-on' : ''}`}
                      onClick={() => setFormat(v)}
                      title={v === 'both' ? 'Read some and listened to some' : `You ${label.toLowerCase()} it`}
                    >
                      <Icon name={v === 'audiobook' ? 'headphones' : 'book'} size={13} /> {label}
                    </button>
                  ))}
                </span>
              )}
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
