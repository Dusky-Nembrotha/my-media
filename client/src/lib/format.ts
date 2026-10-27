import type { MediaType } from './types'

interface SectionInfoMeta {
  label: string
  singular: string
  verb: string        // what you did: "Watched"
  action: string      // what you are about to do: "Watch"
  done: string        // the tab for things you have finished
  planned: string     // the tab for things you have not
  hue: string
  aspect: string
  icon: string
  path: string
}

export const SECTION_META: Record<MediaType, SectionInfoMeta> = {
  film: { label: 'Films', singular: 'Film', verb: 'Watched', action: 'Watch', done: 'Watched', planned: 'To watch', hue: 'var(--hue-film)', aspect: '2 / 3', icon: 'film', path: '/films' },
  tv: { label: 'TV', singular: 'Show', verb: 'Watched', action: 'Watch', done: 'Watched', planned: 'To watch', hue: 'var(--hue-tv)', aspect: '2 / 3', icon: 'tv', path: '/tv' },
  book: { label: 'Books', singular: 'Book', verb: 'Read', action: 'Read', done: 'Read', planned: 'To read', hue: 'var(--hue-book)', aspect: '2 / 3', icon: 'book', path: '/books' },
  audiobook: { label: 'Audiobooks', singular: 'Audiobook', verb: 'Listened to', action: 'Listen to', done: 'Heard', planned: 'To listen to', hue: 'var(--hue-audiobook)', aspect: '1 / 1', icon: 'headphones', path: '/audiobooks' },
  album: { label: 'Music', singular: 'Album', verb: 'Listened to', action: 'Listen to', done: 'Heard', planned: 'To listen to', hue: 'var(--hue-album)', aspect: '1 / 1', icon: 'disc', path: '/music' },
  track: { label: 'Tracks', singular: 'Track', verb: 'Listened to', action: 'Listen to', done: 'Heard', planned: 'To listen to', hue: 'var(--hue-track)', aspect: '1 / 1', icon: 'note', path: '/tracks' },
  podcast: { label: 'Podcasts', singular: 'Podcast', verb: 'Listened to', action: 'Listen to', done: 'Heard', planned: 'To listen to', hue: 'var(--hue-podcast)', aspect: '1 / 1', icon: 'mic', path: '/podcasts' },
  game: { label: 'Games', singular: 'Game', verb: 'Played', action: 'Play', done: 'Played', planned: 'To play', hue: 'var(--hue-game)', aspect: '2 / 3', icon: 'gamepad', path: '/games' },
}

/*
 * Audiobooks are not a separate library: a book is a book, and whether you
 * read or listened to it is recorded on the entry. The type survives in the
 * data model so old imports and links still resolve, but it is not a section.
 */
export const TYPE_ORDER: MediaType[] = ['film', 'tv', 'book', 'album', 'podcast', 'game', 'track']

export function typeOf(path: string): MediaType | null {
  const hit = TYPE_ORDER.find((t) => SECTION_META[t].path === path)
  return hit ?? null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(iso: string | null | undefined, opts: { year?: boolean } = {}) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y) return iso
  const day = d ? `${d} ` : ''
  const month = m ? `${MONTHS[m - 1]}` : ''
  return `${day}${month}${opts.year === false ? '' : ` ${y}`}`.trim()
}

export function fmtMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS[(m || 1) - 1]} ${String(y).slice(2)}`
}

export function relDate(iso: string | null | undefined) {
  if (!iso) return 'date unknown'
  const then = new Date(iso + 'T12:00:00').getTime()
  const days = Math.round((Date.now() - then) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 31) return `${Math.round(days / 7)} week${days < 14 ? '' : 's'} ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  const years = days / 365
  return years < 1.5 ? 'a year ago' : `${Math.round(years)} years ago`
}

export function fmtRuntime(mins: number | null | undefined) {
  if (!mins) return ''
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export function fmtNumber(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-GB')
}

export function fmtRating(r: number | null | undefined) {
  if (r === null || r === undefined) return '—'
  return (Math.round(r * 10) / 10).toFixed(1)
}

export function creatorLine(creators: { role?: string; name: string }[] | undefined, max = 2) {
  if (!creators?.length) return ''
  return creators.filter((c) => c.role !== 'Cast').slice(0, max).map((c) => c.name).join(', ')
}

export function statusLabel(status: string | null | undefined, type: MediaType) {
  switch (status) {
    case 'in_progress': return type === 'book' || type === 'audiobook' ? 'Reading' : type === 'game' ? 'Playing' : 'Watching'
    case 'abandoned': return 'Abandoned'
    case 'planned': return 'Planned'
    default: return null
  }
}

export function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
