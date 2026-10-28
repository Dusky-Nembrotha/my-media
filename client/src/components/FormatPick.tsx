import { Icon } from './Icon'

export type BookFormat = 'book' | 'audiobook' | 'both'

/**
 * How a book was taken in.
 *
 * Two toggles rather than three choices. "Both" was a third thing to read and
 * understand for a state the other two already describe between them, and it
 * sat in the row looking like a different kind of book rather than the sum of
 * the two beside it. Ticking both now says the same thing, and still stores
 * 'both', which is what the filters and the library counts are built on.
 */
export function FormatPick({ value, onChange }: {
  value: BookFormat
  onChange: (v: BookFormat) => void
}) {
  const read = value === 'book' || value === 'both'
  const heard = value === 'audiobook' || value === 'both'

  function set(nextRead: boolean, nextHeard: boolean) {
    // A book you have logged was taken in somehow, so the last one stays on.
    if (!nextRead && !nextHeard) return
    onChange(nextRead && nextHeard ? 'both' : nextRead ? 'book' : 'audiobook')
  }

  const stuck = (on: boolean, other: boolean) => on && !other

  return (
    <>
      <button
        type="button"
        className={`chip${read ? ' is-on' : ''}`}
        aria-pressed={read}
        onClick={() => set(!read, heard)}
        title={stuck(read, heard) ? 'It has to be one or the other' : 'You read it'}
      >
        <Icon name="book" size={13} /> Read
      </button>
      <button
        type="button"
        className={`chip${heard ? ' is-on' : ''}`}
        aria-pressed={heard}
        onClick={() => set(read, !heard)}
        title={stuck(heard, read) ? 'It has to be one or the other' : 'You listened to it'}
      >
        <Icon name="headphones" size={13} /> Listened to
      </button>
    </>
  )
}
