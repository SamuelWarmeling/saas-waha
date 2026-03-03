import { useEffect, useState } from 'react'
import { MdNotifications, MdPerson } from 'react-icons/md'
import api from '../api'

export default function Header() {
  const [user, setUser] = useState(null)

  useEffect(() => {
    api.get('/usuarios/me').then(r => setUser(r.data)).catch(() => { })
  }, [])

  const isPlanActive = user?.plan_expires_at
    ? new Date(user.plan_expires_at) > new Date()
    : false

  const planLabel = {
    starter: 'Starter',
    pro: 'Pro',
    business: 'Business',
  }

  return (
    <header
      className="h-16 flex items-center justify-between px-6 sticky top-0 z-20"
      style={{
        background: 'rgba(26,22,37,0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(157,78,221,0.2)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      <div />
      <div className="flex items-center gap-4">
        {user && (
          <div className="flex items-center gap-2">
            <span
              className="text-xs px-2.5 py-1 rounded-full font-semibold"
              style={
                isPlanActive
                  ? {
                      background: 'rgba(157,78,221,0.12)',
                      color: '#b07de6',
                      border: '1px solid rgba(157,78,221,0.35)',
                      boxShadow: '0 0 12px rgba(157,78,221,0.15)',
                    }
                  : {
                      background: 'rgba(239,68,68,0.12)',
                      color: '#f87171',
                      border: '1px solid rgba(239,68,68,0.3)',
                    }
              }
            >
              {isPlanActive ? `Plano ${planLabel[user.plan] || user.plan}` : 'Plano expirado'}
            </span>
          </div>
        )}
        <button
          className="relative w-10 h-10 flex items-center justify-center rounded-xl text-surface-400 transition-all"
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
        <div
          className="flex items-center gap-3 rounded-xl px-4 py-2 cursor-pointer transition-all"
          style={{
            background: 'rgba(26,22,37,0.6)',
            border: '1px solid rgba(157,78,221,0.2)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(157,78,221,0.1)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(26,22,37,0.6)' }}
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white shadow-sm"
            style={{ background: 'linear-gradient(135deg, #9D4EDD, #6A0DAD)' }}
          >
            <MdPerson className="text-sm" />
          </div>
          <span className="text-sm font-medium text-surface-200">{user?.name || '...'}</span>
        </div>
      </div>
    </header>
  )
}
