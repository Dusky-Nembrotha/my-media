import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { PosterArt, PosterSkeleton } from './Poster'
import { Empty } from './Modal'
import { api } from '../lib/api'
import { useApp, useFetch } from '../lib/store'
import { SECTION_META, creatorLine } from '../lib/format'
import type { MediaType } from '../lib/types'

interface HotItem {
  type: MediaType
  title: string
  year: number | null
  poster_url: string | null
  overview: string | null
  creators: { role?: string; name: string }[]
  genres: string[]
  external_rating: number | null
  work_id: number | null
  inLibrary: boolean
  onList: boolean
}

/**
 * What everyone is talking about in this medium at the moment.
 *
 * Deliberately not personalised — Suggestions already answers "what would I
 * like", and this answers the different question of what is going on. Things
 * you already have are marked rather than hidden: knowing you have seen the
 * film everyone is discussing is worth knowing.
 */
export function Hot({ type }: { type: MediaType }) {
  const meta = SECTION_META[type]
  const { toast, refresh } = useApp()
  const { data, loading } = useFetch<{ source: string | null; items: HotItem[]; unsupported?: boolean }>(
    `/hot?type=${type}&limit=30`, [type],
  )
  const [added, setAdded] = useState<Record<string, true>>({})
  const [busy, setBusy] = useState<string | null>(null)

  async function add(item: HotItem) {
    setBusy(item.title)
    try {
      await api.post('/recs', {
        type: item.type, title: item.title, year: item.year,
        creators: item.creators, poster_url: item.poster_url,
        note: 'Trending',
      })
      toast(`${item.title} added to ${meta.planned.toLowerCase()}`)
      setAdded((a) => ({ ...a, [item.title]: true }))
      void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setBusy(null) }
  }

  if (loading) {
    return <div className="grid">{Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={i} aspect={meta.aspect} />)}</div>
  }

  if (data?.unsupported || !data?.items?.length) {
    return (
      <Empty icon="sparkle" title={`No chart for ${meta.label.toLowerCase()}`}>
        {data?.unsupported
          ? 'There is no free source for what is popular in games, and inventing one would be worse than saying so.'
          : 'The source is quiet at the moment. Try again later.'}
      </Empty>
    )
  }

  return (
    <>
      <p className="u-sm u-mut" style={{ margin: '4px 0 14px' }}>
        What is being watched, read and talked about most right now · {data.source}
      </p>

      <div className="grid" style={{ ['--card-w' as string]: meta.aspect === '1 / 1' ? '164px' : '150px' }}>
        {data.items.map((item, i) => {
          const body = (
            <>
              <span className="hotrank u-tnum">{i + 1}</span>
              <PosterArt src={item.poster_url} title={item.title} type={item.type} aspect={meta.aspect} />
              <div className="poster__meta">
                <div className="poster__title">{item.title}</div>
                <div className="poster__sub u-trunc">
                  {[item.year, creatorLine(item.creators, 1)].filter(Boolean).join(' · ')}
                </div>
              </div>
            </>
          )

          if (item.work_id) {
            return (
              <Link key={item.title} to={`/work/${item.work_id}`} className="poster hotcard is-mine" title={`${item.title} — already yours`}>
                {body}
                <span className="hotflag">Yours</span>
              </Link>
            )
          }

          return (
            <div key={item.title} className="poster hotcard">
              {body}
              {added[item.title] || item.onList ? (
                <span className="hotflag">On your list</span>
              ) : (
                <button
                  className="btn btn--sm hotadd"
                  disabled={busy === item.title}
                  onClick={() => add(item)}
                >
                  <Icon name="plus" size={13} /> {meta.planned}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
