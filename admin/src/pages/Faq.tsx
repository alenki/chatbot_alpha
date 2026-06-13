import { useEffect, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../api'

interface FaqItem {
  id: number
  title: string
  content: string
  updatedAt: string
}

export default function Faq() {
  const [items, setItems] = useState<FaqItem[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      setItems(await apiGet<FaqItem[]>('/api/faq'))
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function startNew() {
    setEditingId(null)
    setTitle('')
    setContent('')
  }

  function startEdit(item: FaqItem) {
    setEditingId(item.id)
    setTitle(item.title)
    setContent(item.content)
  }

  async function save() {
    if (title.trim() === '' || content.trim() === '') return
    setBusy(true)
    setError('')
    try {
      if (editingId === null) {
        await apiPost('/api/faq', { title, content })
      } else {
        await apiPut(`/api/faq/${editingId}`, { title, content })
      }
      startNew()
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    setError('')
    try {
      await apiDelete(`/api/faq/${id}`)
      if (editingId === id) startNew()
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div>
      <h1>FAQ</h1>
      {error !== '' && <div className="error">{error}</div>}

      <div className="section form-grid">
        <h2>{editingId === null ? 'Новая запись' : `Редактирование #${editingId}`}</h2>
        <div>
          <label htmlFor="faq-title">Заголовок</label>
          <input id="faq-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="faq-content">Текст</label>
          <textarea id="faq-content" rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
        </div>
        <div className="row" style={{ display: 'flex', gap: 8 }}>
          <button className="primary" onClick={() => void save()} disabled={busy || title.trim() === '' || content.trim() === ''}>
            Сохранить
          </button>
          {editingId !== null && <button onClick={startNew}>Отмена</button>}
        </div>
      </div>

      <div className="section">
        <h2>Записи</h2>
        <table>
          <thead>
            <tr>
              <th>Заголовок</th>
              <th>Текст</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.title}</td>
                <td style={{ maxWidth: 480, color: '#555' }}>{item.content}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => startEdit(item)}>Изменить</button>{' '}
                  <button onClick={() => void remove(item.id)}>Удалить</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: '#999' }}>
                  Пока нет записей
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
