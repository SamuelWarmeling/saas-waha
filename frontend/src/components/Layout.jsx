import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

function ImpersonateBanner() {
  const navigate = useNavigate()
  const email = sessionStorage.getItem('impersonate_email')
  if (!email) return null

  function voltarAdmin() {
    const adminToken = sessionStorage.getItem('admin_token')
    const adminUser = sessionStorage.getItem('admin_user')
    if (adminToken) localStorage.setItem('access_token', adminToken)
    if (adminUser) localStorage.setItem('user', adminUser)
    sessionStorage.removeItem('admin_token')
    sessionStorage.removeItem('admin_user')
    sessionStorage.removeItem('impersonate_email')
    navigate('/admin')
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm font-semibold z-30 flex-shrink-0"
      style={{ background: '#dc2626', color: '#fff' }}>
      <span>⚠️ Visualizando como <strong>{email}</strong></span>
      <button
        onClick={voltarAdmin}
        className="ml-4 px-3 py-1 rounded-lg text-xs font-bold transition-colors"
        style={{ background: '#fff', color: '#dc2626' }}
        onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
      >
        ← Voltar para Admin
      </button>
    </div>
  )
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950 font-sans text-surface-50 antialiased selection:bg-primary-500/30 selection:text-primary-100">
      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-col flex-1 overflow-hidden relative min-w-0">
        {/* Background gradient effects */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary-950/20 blur-[140px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary-900/15 blur-[140px] pointer-events-none" />

        <ImpersonateBanner />
        <Header onMenuOpen={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-3 md:p-6 relative z-10 scroll-smooth">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
