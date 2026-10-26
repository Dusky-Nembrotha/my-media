import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Modal, Empty } from '../components/Modal'
import { PosterCard } from '../components/Poster'
import { api } from '../lib/api'
import { useApp, useFetch } from '../lib/store'
import { SECTION_META } from '../lib/format'
import type { WorkCard } from '../lib/types'

interface ListRow { id: number; name: string; slug: string; description: string | null; items: number; cover: string | null }

export function ListsPage() {
  const { toast, refresh } = useApp()
  const { data, loading, reload } = useFetch<{ lists: ListRow[] }>('/lists')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  async function create() {
    if (!name.trim()) return
    try {
      await api.post('/lists', { name: name.trim(), description: description.trim() || null })
      toast('List created')
      setCreating(false); setName(''); setDescription('')
      reload(); void refresh()
    } catch (err) { toast((err as Error).message, 'error') }
  }

  const lists = data?.lists ?? []

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <h1 style={{ fontSize: 24 }}>Lists</h1>
          <p>Collections of your own, plus any imported from Letterboxd or IMDb</p>
        </div>
        <button className="btn btn--primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> New list</button>
      </div>

      {loading ? (
        <div className="grid grid--wide">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skel" style={{ height: 150 }} />)}</div>
      ) : !lists.length ? (
        <Empty icon="list" title="No lists yet" action={<button className="btn btn--primary" onClick={() => setCreating(true)}>Create one</button>}>
          Lists are good for “best of the decade”, “comfort rewatches”, or a reading order.
        </Empty>
      ) : (
        <div className="grid grid--wide">
          {lists.map((l) => (
            <Link key={l.id} to={`/lists/${l.slug}`} className="listcard">
              {l.cover ? <img src={l.cover} alt="" loading="lazy" /> : <span className="listcard__blank" />}
              <span className="listcard__body">
                <strong>{l.name}</strong>
                <span className="u-xs u-mut">{l.items} title{l.items === 1 ? '' : 's'}</span>
                {l.description && <span className="u-xs u-mut u-clamp-2">{l.description}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <Modal
          title="New list"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={create}>Create</button>
            </>
          }
        >
          <div className="sheet__body">
            <div className="field">
              <label htmlFor="l-name">Name</label>
              <input id="l-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Comfort rewatches" />
            </div>
            <div className="field">
              <label htmlFor="l-desc">Description</label>
              <textarea id="l-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function ListDetailPage() {
  const { slug } = useParams()
  const { toast, refresh } = useApp()
  const { data, loading, reload } = useFetch<{ list: ListRow; items: WorkCard[] }>(slug ? `/lists/${slug}` : null, [slug])

  async function removeItem(workId: number) {
    try {
      await api.del(`/lists/${slug}/items/${workId}`)
      reload()
    } catch (err) { toast((err as Error).message, 'error') }
  }

  async function deleteList() {
    try {
      await api.del(`/lists/${slug}`)
      toast('List deleted')
      void refresh()
      window.history.back()
    } catch (err) { toast((err as Error).message, 'error') }
  }

  if (loading) return <div className="page"><div className="skel" style={{ height: 180 }} /></div>
  if (!data) return <div className="page"><p className="u-mut">List not found.</p></div>

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <Link to="/lists" className="u-xs linkish"><Icon name="chevronLeft" size={12} /> All lists</Link>
          <h1 style={{ fontSize: 24, marginTop: 4 }}>{data.list.name}</h1>
          <p>{data.items.length} title{data.items.length === 1 ? '' : 's'}{data.list.description ? ` · ${data.list.description}` : ''}</p>
        </div>
        <button className="btn btn--ghost btn--danger btn--sm" onClick={deleteList}><Icon name="trash" size={14} /> Delete list</button>
      </div>

      {!data.items.length ? (
        <Empty icon="list" title="Nothing on this list yet">Open any title and add it from the sidebar.</Empty>
      ) : (
        <div className="grid">
          {data.items.map((w) => (
            <div key={w.id} style={{ position: 'relative' }}>
              <PosterCard work={w} aspect={SECTION_META[w.type].aspect} />
              <button
                className="iconbtn listremove"
                onClick={() => removeItem(w.id)}
                aria-label={`Remove ${w.title}`}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
