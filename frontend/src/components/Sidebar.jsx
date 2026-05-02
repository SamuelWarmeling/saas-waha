import { NavLink, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  MdDashboard, MdCampaign, MdContacts, MdPhoneAndroid,
  MdSettings, MdLogout, MdWhatsapp, MdAdminPanelSettings, MdGroup,
  MdFilterAlt, MdLocalFireDepartment, MdChevronLeft, MdChevronRight,
} from 'react-icons/md'

const links = [
  { to: '/dashboard',     icon: MdDashboard,          label: 'Dashboard' },
  { to: '/campanhas',     icon: MdCampaign,            label: 'Campanhas' },
  { to: '/contatos',      icon: MdContacts,            label: 'Contatos' },
  { to: '/sessoes',       icon: MdPhoneAndroid,        label: 'Sessões' },
  { to: '/grupos',        icon: MdGroup,               label: 'Grupos' },
  { to: '/funil',         icon: MdFilterAlt,           label: 'Funil 🎯' },
  { to: '/aquecimento',   icon: MdLocalFireDepartment, label: 'Aquecimento 🔥' },
  { to: '/configuracoes', icon: MdSettings,            label: 'Configurações' },
]

function getIsAdmin() {
  try {
    const raw = localStorage.getItem('user')
    return raw ? JSON.parse(raw).is_admin === true : false
  } catch {
    return false
  }
}

export default function Sidebar({ collapsed, setCollapsed }) {
  const navigate = useNavigate()
  const isAdmin = getIsAdmin()

  function logout() {
    localStorage.clear()
    navigate('/login')
  }

  const W = collapsed ? 72 : 240

  return (
    <motion.aside
      animate={{ width: W }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden"
      style={{
        background: '#1A1625',
        borderRight: '1px solid rgba(157,78,221,0.2)',
      }}
    >
      {/* Logo */}
      <div
        className="h-16 flex items-center px-4 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(157,78,221,0.15)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #9D4EDD, #6A0DAD)' }}
        >
          <MdWhatsapp className="text-white text-lg" />
        </div>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 }}
            className="ml-3 overflow-hidden whitespace-nowrap"
          >
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
          </motion.div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'text-primary-400'
                  : 'text-surface-400 hover:text-surface-100'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? { background: 'rgba(157,78,221,0.15)', boxShadow: '0 0 12px rgba(157,78,221,0.1)' }
                : {}
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`text-xl flex-shrink-0 transition-colors ${isActive ? 'text-primary-400' : 'text-surface-500'}`} />
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}

        {isAdmin && (
          <NavLink
            to="/admin"
            title={collapsed ? 'Admin' : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 mt-2 ${
                isActive ? 'text-primary-400' : 'text-surface-400 hover:text-surface-100'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? { background: 'rgba(157,78,221,0.15)', boxShadow: '0 0 12px rgba(157,78,221,0.1)' }
                : {}
            }
          >
            {({ isActive }) => (
              <>
                <MdAdminPanelSettings className={`text-xl flex-shrink-0 ${isActive ? 'text-primary-400' : 'text-surface-500'}`} />
                {!collapsed && <span className="truncate">Admin</span>}
              </>
            )}
          </NavLink>
        )}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(v => !v)}
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        className="mx-2 mb-2 flex items-center justify-center h-9 rounded-lg text-surface-500 hover:text-surface-100 hover:bg-surface-800/50 transition-colors flex-shrink-0"
      >
        {collapsed
          ? <MdChevronRight className="text-xl" />
          : <MdChevronLeft className="text-xl" />
        }
      </button>

      {/* Logout */}
      <div className="p-2 flex-shrink-0" style={{ borderTop: '1px solid rgba(157,78,221,0.15)' }}>
        <button
          onClick={logout}
          title={collapsed ? 'Sair' : undefined}
          className="w-full flex items-center justify-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium text-surface-400 hover:bg-red-900/20 hover:text-red-400 transition-all duration-200"
        >
          <MdLogout className="text-xl flex-shrink-0" />
          {!collapsed && <span className="truncate">Sair</span>}
        </button>
      </div>
    </motion.aside>
  )
}
