import { useState } from 'react'
import { apiPost } from '../api'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiPost('/api/login', { password })
      window.location.href = '/chats'
    } catch {
      setError('Неверный пароль')
      setBusy(false)
    }
  }

  return (
    <div className="loading">
      <form className="form-grid" onSubmit={submit} style={{ margin: '80px auto', maxWidth: 320 }}>
        <h1>Вход</h1>
        <div>
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        {error !== '' && <div className="error">{error}</div>}
        <button className="primary" type="submit" disabled={busy || password === ''}>
          Войти
        </button>
      </form>
    </div>
  )
}
