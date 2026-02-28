import { useEffect, useState } from 'react'
import { MdNotifications, MdPerson } from 'react-icons/md'
import api from '../api'

export default function Header() {
  const [user, setUser] = useState(null)

  useEffect(() => {
    api.get('/usuarios/me').then(r => setUser(r.data)).catch(() => {})
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
    <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6">
      <div />
      <div className="flex items-center gap-4">
        {user && (
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                isPlanActive
                  ? 'bg-green-900/60 text-green-400'
                  : 'bg-red-900/60 text-red-400'
              }`}
            >
              {isPlanActive ? `Plano ${planLabel[user.plan] || user.plan}` : 'Plano expirado'}
            </span>
          </div>
        )}
        <button className="relative text-gray-400 hover:text-gray-200 transition-colors">
          <MdNotifications className="text-xl" />
        </button>
        <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5">
          <MdPerson className="text-gray-400" />
          <span className="text-sm text-gray-300">{user?.name || '...'}</span>
        </div>
      </div>
    </header>
  )
}
