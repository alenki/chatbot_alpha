import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiGet, apiPost } from '../api'

interface ChatListItem {
  id: number
  channel: string
  status: string
  botPaused: boolean
  clientName: string | null
  lastPreview: string
  unanswered: boolean
}

interface Message {
  id: number
  role: string
  content: string
  attachments: { name: string }[]
  createdAt: string
}

export default function Chats() {
  const params = useParams()
  const navigate = useNavigate()
  const selectedId = params.id !== undefined ? Number(params.id) : null

  const [statusFilter, setStatusFilter] = useState('')
  const [chats, setChats] = useState<ChatListItem[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectedChat = chats.find((c) => c.id === selectedId) ?? null

  async function loadChats() {
    try {
      const query = statusFilter !== '' ? `?status=${encodeURIComponent(statusFilter)}` : ''
      setChats(await apiGet<ChatListItem[]>(`/api/chats${query}`))
    } catch (e) {
      setError(String(e))
    }
  }

  async function loadMessages(id: number) {
    try {
      setMessages(await apiGet<Message[]>(`/api/chats/${id}/messages`))
    } catch (e) {
      setError(String(e))
    }
  }

  // Poll the chat list every 5s.
  useEffect(() => {
    void loadChats()
    const t = setInterval(() => void loadChats(), 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  // Poll the selected thread every 5s.
  useEffect(() => {
    if (selectedId === null) {
      setMessages([])
      return
    }
    void loadMessages(selectedId)
    const t = setInterval(() => void loadMessages(selectedId), 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Auto-scroll the thread to the newest message.
  const threadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (threadRef.current !== null) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  async function sendReply() {
    if (selectedId === null || reply.trim() === '') return
    setBusy(true)
    setError('')
    try {
      await apiPost(`/api/chats/${selectedId}/reply`, { text: reply })
      setReply('')
      await loadMessages(selectedId)
      await loadChats()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleBot() {
    if (selectedChat === null) return
    setBusy(true)
    setError('')
    try {
      await apiPost(`/api/chats/${selectedChat.id}/bot`, { paused: !selectedChat.botPaused })
      await loadChats()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>Чаты</h1>
      {error !== '' && <div className="error">{error}</div>}
      <div className="toolbar">
        <span>Статус:</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 160 }}>
          <option value="">Все</option>
          <option value="ai">ИИ</option>
          <option value="human">Человек</option>
          <option value="closed">Закрыт</option>
        </select>
      </div>
      <div className="chats-layout">
        <div className="chat-list">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={chat.id === selectedId ? 'chat-list-item selected' : 'chat-list-item'}
              onClick={() => navigate(`/chats/${chat.id}`)}
            >
              <div>
                <strong>{chat.clientName ?? `Чат #${chat.id}`}</strong>
                <span style={{ color: '#999', fontSize: 12 }}> · {chat.status}</span>
                {chat.unanswered && <span className="badge">!</span>}
              </div>
              <div className="preview">{chat.lastPreview}</div>
            </div>
          ))}
          {chats.length === 0 && <div style={{ padding: 12, color: '#999' }}>Нет чатов</div>}
        </div>

        <div className="chat-thread">
          {selectedChat === null ? (
            <div style={{ padding: 24, color: '#999' }}>Выберите чат слева</div>
          ) : (
            <>
              <div className="toolbar" style={{ padding: '12px 16px', margin: 0, borderBottom: '1px solid #eceef1' }}>
                <strong>{selectedChat.clientName ?? `Чат #${selectedChat.id}`}</strong>
                <span style={{ flex: 1 }} />
                <button onClick={toggleBot} disabled={busy}>
                  {selectedChat.botPaused ? 'Включить бота' : 'Остановить бота'}
                </button>
              </div>
              <div className="messages" ref={threadRef}>
                {messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.role}`}>
                    {m.content}
                    {m.attachments.length > 0 && (
                      <div style={{ fontSize: 12, color: '#555' }}>
                        📎 {m.attachments.map((a) => a.name).join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="reply-box">
                <textarea
                  rows={3}
                  placeholder="Ответ менеджера…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <div className="row">
                  <span style={{ flex: 1 }} />
                  <button className="primary" onClick={sendReply} disabled={busy || reply.trim() === ''}>
                    Отправить
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
