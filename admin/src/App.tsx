import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { apiGet } from './api'
import Login from './pages/Login'
import Chats from './pages/Chats'
import Orders from './pages/Orders'
import Catalog from './pages/Catalog'
import Faq from './pages/Faq'
import Settings from './pages/Settings'
import Usage from './pages/Usage'

const NAV: { to: string; label: string }[] = [
  { to: '/chats', label: 'Чаты' },
  { to: '/orders', label: 'Заказы' },
  { to: '/catalog', label: 'Каталог' },
  { to: '/faq', label: 'FAQ' },
  { to: '/settings', label: 'Настройки' },
  { to: '/usage', label: 'Статистика' },
]

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-title">ИИ-агент</div>
        <nav>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const [checked, setChecked] = useState(false)
  const isLoginRoute = location.pathname === '/login'

  useEffect(() => {
    if (isLoginRoute) {
      setChecked(true)
      return
    }
    // Auth gate: a 401 redirects to /login inside apiGet; otherwise we are authenticated.
    apiGet('/api/chats')
      .then(() => setChecked(true))
      .catch(() => setChecked(true))
  }, [isLoginRoute])

  if (isLoginRoute) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    )
  }

  if (!checked) {
    return <div className="loading">Загрузка…</div>
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/chats" replace />} />
        <Route path="/chats" element={<Chats />} />
        <Route path="/chats/:id" element={<Chats />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="*" element={<Navigate to="/chats" replace />} />
      </Routes>
    </Layout>
  )
}
