export interface GenreCount { name: string; count: number }

/**
 * Narrow a chart or a suggestion list to one genre.
 *
 * The options come from whatever is actually in the list rather than a fixed
 * vocabulary — today's chart has the genres it has — and they stay put once
 * a choice is made, so changing your mind does not mean clearing it first.
 */
export function GenrePick({ genres, value, onChange, label = 'Genre' }: {
  genres: GenreCount[]
  value: string | null
  onChange: (genre: string | null) => void
  label?: string
}) {
  if (!genres.length) return null
  return (
    <div className="selectwrap">
      <select
        className="select select--sm"
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">All genres</option>
        {genres.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
      </select>
    </div>
  )
}
