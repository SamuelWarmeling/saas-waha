import { NavLink, useNavigate } from 'react-router-dom'
import {
  MdDashboard, MdCampaign, MdContacts, MdPhoneAndroid,
  MdSettings, MdLogout, MdWhatsapp, MdAdminPanelSettings, MdGroup,
} from 'react-icons/md'

const links = [
  { to: '/dashboard', icon: MdDashboard, label: 'Dashboard' },
  { to: '/campanhas', icon: MdCampaign, label: 'Campanhas' },
  { to: '/contatos', icon: MdContacts, label: 'Contatos' },
  { to: '/sessoes', icon: MdPhoneAndroid, label: 'Sessões' },
  { to: '/grupos', icon: MdGroup, label: 'Grupos' },
  { to: '/configuracoes', icon: MdSettings, label: 'Configurações' },
]

function getIsAdmin() {
  try {
    const raw = localStorage.getItem('user')
    return raw ? JSON.parse(raw).is_admin === true : false
  } catch {
    return false
  }
}

export default function Sidebar() {
  const navigate = useNavigate()
  const isAdmin = getIsAdmin()

  function logout() {
    localStorage.clear()
    navigate('/login')
  }

  return (
    <aside className="w-60 bg-surface-900/40 backdrop-blur-xl border-r border-surface-700/50 flex flex-col relative z-10">
      {/* Logo */}
      <div className="p-5 border-b border-surface-700/50 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-900/50 border border-primary-300/20">
          <MdSettings className="text-white text-2xl" />
        </div>
        <div>
          <p className="font-bold text-white text-sm leading-none tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-white to-surface-300">WahaSaaS</p>
          <p className="text-xs text-primary-400 mt-0.5 font-medium">Disparo em massa</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${isActive
                ? 'bg-primary-600/20 text-primary-300 border border-primary-500/30 shadow-lg shadow-primary-900/20'
                : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-100 hover:border-surface-600/50 border border-transparent'
              }`
            }
          >
            <Icon className={`text-xl transition-colors ${({ isActive }) => isActive ? 'text-primary-400' : 'text-surface-400 group-hover:text-primary-400'}`} />
            {label}
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 mt-2 ${isActive
                ? 'bg-primary-600/20 text-primary-300 border border-primary-500/30 shadow-lg shadow-primary-900/20'
                : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-100 hover:border-surface-600/50 border border-transparent'
              }`
            }
          >
            <MdAdminPanelSettings className="text-xl" />
            Admin
          </NavLink>
        )}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-surface-700/50 mt-auto">
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-surface-400 hover:bg-red-900/30 hover:text-red-400 transition-all duration-300 border border-transparent hover:border-red-500/30"
        >
          <MdLogout className="text-xl" />
          Sair
        </button>
      </div>
    </aside>
  )
}
