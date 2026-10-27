import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { artworkUrl } from '../lib/img'
import { Stars } from './Stars'
import { SECTION_META, creatorLine, statusLabel } from '../lib/format'
import type { MediaType } from '../lib/types'

export function PosterArt({ src, title, type, rating, liked, flag, aspect }: {
  src?: string | null
  title: string
  type: MediaType
  rating?: number | null
  liked?: boolean
  flag?: string | null
  aspect?: string
}) {
  const meta = SECTION_META[type]
  return (
    <div className="poster__frame" style={{ ['--ar' as string]: aspect || meta.aspect, ['--hue' as string]: meta.hue }}>
      {src
        ? <img src={artworkUrl(src)} alt="" loading="lazy" decoding="async" />
        : <div className="poster__fallback" style={{ ['--hue' as string]: meta.hue }}>{title}</div>}
      <div className="poster__veil">
        <span className="poster__veil-title">{title}</span>
      </div>
      {rating != null && (
        <span className="poster__badge" title={`You rated this ${rating}`}>
          <Icon name="star" size={11} strokeWidth={0} className="poster__badge-star" />
          {rating.toFixed(rating % 1 ? 1 : 0)}
        </span>
      )}
      {rating == null && liked && (
        <span className="poster__badge poster__badge--liked" title="Liked"><Icon name="heart" size={12} /></span>
      )}
      {flag && <span className="poster__flag">{flag}</span>}
    </div>
  )
}

export function PosterCard({ work, showMeta = true, aspect, selectable, selected, onSelect }: {
  work: {
    id: number
    type: MediaType
    title: string
    year: number | null
    poster_url: string | null
    creators?: { role?: string; name: string }[]
    rating: number | null
    liked?: boolean
    entry_count?: number
    status?: string | null
  }
  showMeta?: boolean
  aspect?: string
  /*
   * Selection mode. Once anything is selected, tapping a card picks it rather
   * than opening it — the same behaviour as a photo library, and it stops a
   * stray tap navigating away mid-tidy-up.
   */
  selectable?: boolean
  selected?: boolean
  onSelect?: (id: number) => void
}) {
  const status = statusLabel(work.status, work.type)
  const repeat = (work.entry_count ?? 0) > 1

  const body = (
    <>
      <PosterArt
        src={work.poster_url}
        title={work.title}
        type={work.type}
        rating={work.rating}
        liked={work.liked}
        flag={status || (repeat ? `${work.entry_count}×` : null)}
        aspect={aspect}
      />
      {showMeta && (
        <div className="poster__meta">
          <div className="poster__title">{work.title}</div>
          <div className="poster__sub u-trunc">
            {[work.year, creatorLine(work.creators, 1)].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}
    </>
  )

  if (selectable) {
    return (
      <button
        type="button"
        className={`poster poster--pick${selected ? ' is-picked' : ''}`}
        title={work.title}
        aria-pressed={selected}
        onClick={() => onSelect?.(work.id)}
      >
        <span className="poster__tick"><Icon name={selected ? 'check' : 'plus'} size={13} /></span>
        {body}
      </button>
    )
  }

  return (
    <Link to={`/work/${work.id}`} className="poster" title={work.title}>
      {body}
    </Link>
  )
}

export function PosterSkeleton({ aspect = '2 / 3' }: { aspect?: string }) {
  return (
    <div className="poster">
      <div className="skel" style={{ aspectRatio: aspect, borderRadius: 'var(--r-sm)' }} />
      <div className="poster__meta">
        <div className="skel" style={{ height: 11, width: '82%' }} />
        <div className="skel" style={{ height: 9, width: '52%', marginTop: 6 }} />
      </div>
    </div>
  )
}

export function RatingLine({ rating, size = 13 }: { rating: number | null; size?: number }) {
  if (rating == null) return <span className="u-xs u-mut">unrated</span>
  return <Stars value={rating} size={size} />
}
