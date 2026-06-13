import { useEffect, useState } from 'react'
import { apiGet } from '../api'

interface UsageRow {
  day: string
  clientMessages: number
  aiMessages: number
  managerMessages: number
  promptTokens: number
  completionTokens: number
  escalations: number
}

export default function Usage() {
  const [rows, setRows] = useState<UsageRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    apiGet<UsageRow[]>('/api/usage?days=30')
      .then(setRows)
      .catch((e) => setError(String(e)))
  }, [])

  return (
    <div>
      <h1>Статистика</h1>
      {error !== '' && <div className="error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>День</th>
            <th>Клиент</th>
            <th>ИИ</th>
            <th>Менеджер</th>
            <th>Токены (запрос)</th>
            <th>Токены (ответ)</th>
            <th>Эскалации</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.day}>
              <td>{row.day}</td>
              <td>{row.clientMessages}</td>
              <td>{row.aiMessages}</td>
              <td>{row.managerMessages}</td>
              <td>{row.promptTokens}</td>
              <td>{row.completionTokens}</td>
              <td>{row.escalations}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} style={{ color: '#999' }}>
                Нет данных за период
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
