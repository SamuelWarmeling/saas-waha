import { useEffect, useState } from 'react'
import { MdNotifications, MdPerson, MdMenu } from 'react-icons/md'
import api from '../api'

export default function Header({ onMenuOpen }) {
  const [user, setUser] = useState(null)

  useEffect(() => {
    api.get('/usuarios/me').then(r => setUser(r.data)).catch(() => { })
  }, [])

  const isAdmin = user?.is_admin ?? false
  const isPlanActive = !!(user?.is_active)

  const planLabel = {
    starter: 'Starter',
    pro: 'Pro',
    business: 'Business',
  }

  const badgeStyle = isAdmin
    ? { background: 'rgba(157,78,221,0.18)', color: '#c084fc', border: '1px solid rgba(157,78,221,0.5)', boxShadow: '0 0 12px rgba(157,78,221,0.2)' }
    : isPlanActive
      ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.35)', boxShadow: '0 0 12px rgba(34,197,94,0.15)' }
      : { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }

  const badgeLabel = isAdmin
    ? '★ Admin'
    : isPlanActive
      ? `Plano ${planLabel[user.plan] || user.plan}`
      : 'Plano expirado'

  return (
    <header
      className="h-16 flex items-center justify-between px-4 md:px-6 sticky top-0 z-20"
      style={{
        background: 'rgba(26,22,37,0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(157,78,221,0.2)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      {/* Esquerda: hamburguer (mobile) */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuOpen}
          className="md:hidden w-10 h-10 flex items-center justify-center rounded-xl text-surface-300 hover:text-white transition-colors"
          style={{ border: '1px solid rgba(157,78,221,0.15)' }}
          aria-label="Abrir menu"
        >
          <MdMenu className="text-2xl" />
        </button>
        {/* Logo visível só no mobile */}
        <span
          className="md:hidden font-bold text-sm tracking-wide"
          style={{
            background: 'linear-gradient(90deg, #ffffff, #b07de6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          WahaSaaS
        </span>
        {/* Div vazia no desktop para manter justify-between */}
        <div className="hidden md:block" />
      </div>

      {/* Direita */}
      <div className="flex items-center gap-2 md:gap-4">
        {/* Plano: oculto no mobile */}
        {user && (
          <div className="hidden md:flex items-center gap-2">
            <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={badgeStyle}>
              {badgeLabel}
            </span>
          </div>
        )}

        {/* Notificações: oculto no mobile */}
        <button
          className="hidden md:flex relative w-10 h-10 items-center justify-center rounded-xl text-surface-400 transition-all"
          style={{ border: '1px solid rgba(157,78,221,0.15)' }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(157,78,221,0.1)'
            e.currentTarget.style.color = '#b07de6'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = ''
          }}
        >
          <MdNotifications className="text-xl" />
          <span
            className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full animate-pulse"
            style={{ background: '#9D4EDD', boxShadow: '0 0 8px #9D4EDD' }}
          />
        </button>

        {/* Avatar */}
        <div
          className="flex items-center gap-2 md:gap-3 rounded-xl px-2 md:px-4 py-2 cursor-pointer transition-all"
          style={{
            background: 'rgba(26,22,37,0.6)',
            border: '1px solid rgba(157,78,221,0.2)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(157,78,221,0.1)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(26,22,37,0.6)' }}
        >
          <div
            className="w-7 h-7 md:w-6 md:h-6 rounded-full flex items-center justify-center text-white shadow-sm"
            style={{ background: 'linear-gradient(135deg, #9D4EDD, #6A0DAD)' }}
          >
            <MdPerson className="text-sm" />
          </div>
          <span className="hidden md:block text-sm font-medium text-surface-200">{user?.name || '...'}</span>
        </div>
      </div>
    </header>
  )
}
