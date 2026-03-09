import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

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
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary-900/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary-800/10 blur-[120px] pointer-events-none" />

        <Header onMenuOpen={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-3 md:p-6 relative z-10 scroll-smooth">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
