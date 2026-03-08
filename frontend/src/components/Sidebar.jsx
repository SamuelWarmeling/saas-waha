import { NavLink, useNavigate } from 'react-router-dom'
import {
  MdDashboard, MdCampaign, MdContacts, MdPhoneAndroid,
  MdSettings, MdLogout, MdWhatsapp, MdAdminPanelSettings, MdGroup,
  MdFilterAlt,
} from 'react-icons/md'

const links = [
  { to: '/dashboard', icon: MdDashboard, label: 'Dashboard' },
  { to: '/campanhas', icon: MdCampaign, label: 'Campanhas' },
  { to: '/contatos', icon: MdContacts, label: 'Contatos' },
  { to: '/sessoes', icon: MdPhoneAndroid, label: 'Sessões' },
  { to: '/grupos', icon: MdGroup, label: 'Grupos' },
  { to: '/funil', icon: MdFilterAlt, label: 'Funil 🎯' },
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
    <aside
      className="w-60 flex flex-col relative z-10"
      style={{
        background: '#1A1625',
        borderRight: '1px solid rgba(157,78,221,0.2)',
      }}
    >
      {/* Logo */}
      <div
        className="p-5 flex items-center gap-3"
        style={{ borderBottom: '1px solid rgba(157,78,221,0.15)' }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg border border-primary-400/20"
          style={{ background: 'linear-gradient(135deg, #9D4EDD, #6A0DAD)' }}
        >
          <MdWhatsapp className="text-white text-2xl" />
        </div>
        <div>
          <p
            className="font-bold text-sm leading-none tracking-wide"
            style={{
              background: 'linear-gradient(90deg, #ffffff, #b07de6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            WahaSaaS
          </p>
          <p className="text-xs text-primary-400 mt-0.5 font-medium">Disparo em massa</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'text-primary-400'
                  : 'text-surface-400 hover:text-surface-100'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? {
                    background: 'rgba(157,78,221,0.15)',
                    borderLeft: '2px solid #9D4EDD',
                    paddingLeft: '10px',
                    boxShadow: '0 0 12px rgba(157,78,221,0.1)',
                  }
                : {
                    borderLeft: '2px solid transparent',
                  }
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`text-xl transition-colors ${isActive ? 'text-primary-400' : 'text-surface-500'}`} />
                {label}
              </>
            )}
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 mt-2 ${
                isActive ? 'text-primary-400' : 'text-surface-400 hover:text-surface-100'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? {
                    background: 'rgba(157,78,221,0.15)',
                    borderLeft: '2px solid #9D4EDD',
                    paddingLeft: '10px',
                    boxShadow: '0 0 12px rgba(157,78,221,0.1)',
                  }
                : {
                    borderLeft: '2px solid transparent',
                  }
            }
          >
            {({ isActive }) => (
              <>
                <MdAdminPanelSettings className={`text-xl ${isActive ? 'text-primary-400' : 'text-surface-500'}`} />
                Admin
              </>
            )}
          </NavLink>
        )}
      </nav>

      {/* Logout */}
      <div className="p-3 mt-auto" style={{ borderTop: '1px solid rgba(157,78,221,0.15)' }}>
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-surface-400 hover:bg-red-900/20 hover:text-red-400 transition-all duration-200"
          style={{ border: '1px solid transparent' }}
          onMouseEnter={e => { e.currentTarget.style.border = '1px solid rgba(239,68,68,0.25)' }}
          onMouseLeave={e => { e.currentTarget.style.border = '1px solid transparent' }}
        >
          <MdLogout className="text-xl" />
          Sair
        </button>
      </div>
    </aside>
  )
}
