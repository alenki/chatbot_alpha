import { useEffect, useState } from 'react'
import { apiGet, apiPut } from '../api'

interface SettingsData {
  system_prompt: string
  escalation_keywords: string[]
  daily_turn_cap: number
}

export default function Settings() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [keywords, setKeywords] = useState('')
  const [dailyCap, setDailyCap] = useState('30')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const data = await apiGet<SettingsData>('/api/settings')
      setSystemPrompt(data.system_prompt)
      setKeywords(data.escalation_keywords.join(', '))
      setDailyCap(String(data.daily_turn_cap))
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function save() {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await apiPut('/api/settings', {
        system_prompt: systemPrompt,
        escalation_keywords: keywords
          .split(',')
          .map((k) => k.trim())
          .filter((k) => k !== ''),
        daily_turn_cap: Number(dailyCap) || 0,
      })
      setSaved(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>Настройки</h1>
      {error !== '' && <div className="error">{error}</div>}
      {saved && <div style={{ color: '#27ae60', margin: '8px 0' }}>Сохранено</div>}
      <div className="form-grid">
        <div>
          <label htmlFor="system-prompt">Системный промпт</label>
          <textarea
            id="system-prompt"
            rows={12}
            value={systemPrompt}
            onChange={(e) => {
              setSystemPrompt(e.target.value)
              setSaved(false)
            }}
          />
        </div>
        <div>
          <label htmlFor="keywords">Ключевые слова для эскалации (через запятую)</label>
          <input
            id="keywords"
            value={keywords}
            onChange={(e) => {
              setKeywords(e.target.value)
              setSaved(false)
            }}
          />
        </div>
        <div>
          <label htmlFor="daily-cap">Дневной лимит ответов ИИ</label>
          <input
            id="daily-cap"
            type="number"
            min={1}
            value={dailyCap}
            onChange={(e) => {
              setDailyCap(e.target.value)
              setSaved(false)
            }}
            style={{ maxWidth: 160 }}
          />
        </div>
        <div>
          <button className="primary" onClick={() => void save()} disabled={busy}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
