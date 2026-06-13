import { useEffect, useState } from 'react'
import { apiGet, apiPatch } from '../api'

interface Order {
  id: number
  serviceType: string
  specs: Record<string, string>
  quantity: number | null
  deadline: string | null
  contact: string
  files: { name: string }[]
  status: string
  chatId: number
}

const STATUSES: { key: string; label: string }[] = [
  { key: 'new', label: 'Новые' },
  { key: 'confirmed', label: 'Подтверждены' },
  { key: 'in_work', label: 'В работе' },
  { key: 'done', label: 'Готовы' },
]

const NEXT: Record<string, string | null> = {
  new: 'confirmed',
  confirmed: 'in_work',
  in_work: 'done',
  done: null,
}

const NEXT_LABEL: Record<string, string> = {
  confirmed: 'Подтвердить',
  in_work: 'В работу',
  done: 'Готово',
}

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      setOrders(await apiGet<Order[]>('/api/orders'))
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function advance(order: Order) {
    const next = NEXT[order.status]
    if (next === null) return
    setBusy(true)
    setError('')
    try {
      await apiPatch(`/api/orders/${order.id}`, { status: next })
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>Заказы</h1>
      {error !== '' && <div className="error">{error}</div>}
      <div className="kanban">
        {STATUSES.map((col) => (
          <div key={col.key} className="kanban-column">
            <h2>{col.label}</h2>
            {orders
              .filter((o) => o.status === col.key)
              .map((order) => (
                <div key={order.id} className="order-card">
                  <div className="field">
                    <strong>
                      #{order.id} · {order.serviceType}
                    </strong>
                  </div>
                  {order.quantity !== null && <div className="field">Тираж: {order.quantity}</div>}
                  {order.deadline !== null && <div className="field">Срок: {order.deadline}</div>}
                  {Object.entries(order.specs).map(([k, v]) => (
                    <div className="field" key={k}>
                      {k}: {v}
                    </div>
                  ))}
                  <div className="field">Контакт: {order.contact}</div>
                  {order.files.length > 0 && (
                    <div className="field">📎 {order.files.map((f) => f.name).join(', ')}</div>
                  )}
                  {NEXT[order.status] !== null && (
                    <button
                      style={{ marginTop: 8 }}
                      disabled={busy}
                      onClick={() => void advance(order)}
                    >
                      {NEXT_LABEL[NEXT[order.status]!]}
                    </button>
                  )}
                </div>
              ))}
            {orders.filter((o) => o.status === col.key).length === 0 && (
              <div style={{ color: '#999', fontSize: 13, padding: 8 }}>—</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
