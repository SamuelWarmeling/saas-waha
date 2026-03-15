import { NavLink, useNavigate } from 'react-router-dom'
import {
  MdDashboard, MdCampaign, MdContacts, MdPhoneAndroid,
  MdSettings, MdLogout, MdWhatsapp, MdAdminPanelSettings, MdGroup,
  MdFilterAlt, MdLocalFireDepartment,
} from 'react-icons/md'

const links = [
  { to: '/dashboard', icon: MdDashboard, label: 'Dashboard' },
  { to: '/campanhas', icon: MdCampaign, label: 'Campanhas' },
  { to: '/contatos', icon: MdContacts, label: 'Contatos' },
  { to: '/sessoes', icon: MdPhoneAndroid, label: 'Sessões' },
  { to: '/grupos', icon: MdGroup, label: 'Grupos' },
  { to: '/funil', icon: MdFilterAlt, label: 'Funil 🎯' },
  { to: '/aquecimento', icon: MdLocalFireDepartment, label: 'Aquecimento 🔥' },
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

const ACTIVE_BG = 'rgba(34,211,238,0.10)'
const HOVER_BG  = 'rgba(34,211,238,0.05)'
const ACCENT    = '#22D3EE'

export default function Sidebar({ isOpen, onClose }) {
  const navigate = useNavigate()
  const isAdmin = getIsAdmin()

  function logout() {
    localStorage.clear()
    navigate('/login')
  }

  function navStyle(isActive) {
    return isActive
      ? {
          background: ACTIVE_BG,
          borderLeft: `3px solid ${ACCENT}`,
          paddingLeft: '9px',
          color: ACCENT,
          textShadow: '0 0 8px rgba(34,211,238,0.5)',
        }
      : { borderLeft: '3px solid transparent' }
  }

  function handleEnter(e) {
    if (!e.currentTarget.style.background.includes(ACTIVE_BG.slice(0, -1))) {
      e.currentTarget.style.background = HOVER_BG
    }
  }

  function handleLeave(e) {
    if (!e.currentTarget.style.background.includes(ACTIVE_BG.slice(0, -1))) {
      e.currentTarget.style.background = ''
    }
  }

  return (
    <aside
      className={`
        fixed md:static inset-y-0 left-0 z-50 md:z-10
        w-60 flex-shrink-0 flex flex-col
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}
      style={{
        background: '#0F172A',
        borderRight: '1px solid rgba(255,255,255,0.03)',
      }}
    >
      {/* Logo */}
      <div
        className="p-5 flex items-center gap-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
          style={{ background: 'linear-gradient(135deg, #22D3EE, #06B6D4)' }}
        >
          <MdWhatsapp className="text-white text-2xl" />
        </div>
        <div>
          <p
            className="font-bold text-sm leading-none tracking-wide"
            style={{
              background: 'linear-gradient(90deg, #ffffff, #67e8f9)',
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
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive ? '' : 'text-surface-400 hover:text-surface-100'
              }`
            }
            style={({ isActive }) => navStyle(isActive)}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            {({ isActive }) => (
              <>
                <Icon
                  className="text-xl transition-colors"
                  style={isActive ? { color: ACCENT } : {}}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink
            to="/admin"
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 mt-2 ${
                isActive ? '' : 'text-surface-400 hover:text-surface-100'
              }`
            }
            style={({ isActive }) => navStyle(isActive)}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            {({ isActive }) => (
              <>
                <MdAdminPanelSettings
                  className="text-xl"
                  style={isActive ? { color: ACCENT } : {}}
                />
                Admin
              </>
            )}
          </NavLink>
        )}
      </nav>

      {/* Logout */}
      <div className="p-3 mt-auto" style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
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
