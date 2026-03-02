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
    <header className="h-16 bg-surface-900/40 backdrop-blur-xl border-b border-surface-700/50 flex items-center justify-between px-6 sticky top-0 z-20 shadow-sm">
      <div />
      <div className="flex items-center gap-4">
        {user && (
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${isPlanActive
                  ? 'bg-primary-900/30 text-primary-300 border-primary-500/30 shadow-[0_0_10px_theme(colors.primary.900/40)]'
                  : 'bg-red-900/30 text-red-400 border-red-500/30'
                }`}
            >
              {isPlanActive ? `Plano ${planLabel[user.plan] || user.plan}` : 'Plano expirado'}
            </span>
          </div>
        )}
        <button className="relative w-10 h-10 flex items-center justify-center rounded-xl text-surface-400 hover:text-primary-300 hover:bg-surface-800/50 transition-all border border-transparent hover:border-surface-600/50">
          <MdNotifications className="text-xl" />
          {/* Mock notification dot */}
          <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-primary-500 rounded-full animate-pulse shadow-[0_0_8px_theme(colors.primary.500)]"></span>
        </button>
        <div className="flex items-center gap-3 bg-surface-800/40 border border-surface-700/50 rounded-xl px-4 py-2 hover:bg-surface-800/60 transition-colors cursor-pointer">
          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-primary-500 to-primary-700 flex items-center justify-center text-white shadow-sm shadow-primary-900/50">
            <MdPerson className="text-sm" />
          </div>
          <span className="text-sm font-medium text-surface-200">{user?.name || '...'}</span>
        </div>
      </div>
    </header>
  )
}
