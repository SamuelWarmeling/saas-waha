import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Smartphone, Megaphone, Users, Search,
  Flame, Target, Settings, ShieldCheck, LogOut, ChevronLeft, ChevronRight
} from "lucide-react";

const navItems = [
  { title: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { title: "Sessões", path: "/sessoes", icon: Smartphone },
  { title: "Campanhas", path: "/campanhas", icon: Megaphone },
  { title: "Contatos", path: "/contatos", icon: Users },
  { title: "Extração", path: "/extracao", icon: Search },
  { title: "Aquecimento", path: "/aquecimento", icon: Flame },
  { title: "Funil", path: "/funil", icon: Target },
  { title: "Configurações", path: "/configuracoes", icon: Settings },
  { title: "Admin", path: "/admin", icon: ShieldCheck },
];

export default function Sidebar({ collapsed, setCollapsed }) {
  const location = useLocation();
  const navigate = useNavigate();

  let userName = "Admin";
  let userEmail = "";
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const u = JSON.parse(raw);
      userName = u.name || u.email || "Admin";
      userEmail = u.email || "";
    }
  } catch {}

  const initials = userName.charAt(0).toUpperCase();

  function handleLogout() {
    localStorage.clear();
    navigate("/login");
  }

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="fixed left-0 top-0 h-screen z-50 flex flex-col bg-sidebar/95 backdrop-blur-xl border-r border-sidebar-border overflow-hidden"
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border shrink-0">
        {!collapsed ? (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xl font-bold tracking-[-0.03em] text-foreground whitespace-nowrap"
          >
            Waha<span className="text-primary">SaaS</span>
          </motion.span>
        ) : (
          <span className="text-xl font-bold text-primary mx-auto">W</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              title={collapsed ? item.title : undefined}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                isActive
                  ? "text-primary-foreground"
                  : "text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl bg-primary/20 border border-primary/30"
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              )}
              <item.icon className={`relative z-10 h-5 w-5 shrink-0 ${isActive ? "text-primary" : ""}`} />
              {!collapsed && (
                <span className="relative z-10 truncate">{item.title}</span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="mx-2 mb-2 flex items-center justify-center h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>

      {/* User */}
      <div className="border-t border-sidebar-border p-3 flex items-center gap-3 shrink-0">
        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
          {initials}
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{userName}</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sair"
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </motion.aside>
  );
}
