import { NavLink, useNavigate } from 'react-router-dom'
import {
  MdDashboard, MdCampaign, MdContacts, MdPhoneAndroid,
  MdSettings, MdLogout, MdWhatsapp, MdAdminPanelSettings,
} from 'react-icons/md'

const links = [
  { to: '/dashboard',     icon: MdDashboard,    label: 'Dashboard'      },
  { to: '/campanhas',     icon: MdCampaign,     label: 'Campanhas'      },
  { to: '/contatos',      icon: MdContacts,     label: 'Contatos'       },
  { to: '/sessoes',       icon: MdPhoneAndroid, label: 'Sessões'        },
  { to: '/configuracoes', icon: MdSettings,     label: 'Configurações'  },
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
    <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Logo */}
      <div className="p-5 border-b border-gray-800 flex items-center gap-3">
        <MdWhatsapp className="text-green-500 text-3xl" />
        <div>
          <p className="font-bold text-white text-sm leading-none">WahaSaaS</p>
          <p className="text-xs text-gray-500 mt-0.5">Disparo em massa</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-green-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`
            }
          >
            <Icon className="text-xl" />
            {label}
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-green-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`
            }
          >
            <MdAdminPanelSettings className="text-xl" />
            Admin
          </NavLink>
        )}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-gray-800">
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-red-900/30 hover:text-red-400 transition-colors"
        >
          <MdLogout className="text-xl" />
          Sair
        </button>
      </div>
    </aside>
  )
}
