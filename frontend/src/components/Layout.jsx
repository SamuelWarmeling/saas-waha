import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, User, ShieldAlert } from "lucide-react";
import Sidebar from "./Sidebar";
import api from "../api";

const pageTitles = {
  "/dashboard": "Dashboard",
  "/sessoes": "Sessões",
  "/campanhas": "Campanhas",
  "/contatos": "Contatos",
  "/extracao": "Extração",
  "/aquecimento": "Aquecimento",
  "/funil": "Funil de Leads",
  "/configuracoes": "Configurações",
  "/admin": "Administração",
};

function ImpersonateBanner() {
  const navigate = useNavigate();
  const email = sessionStorage.getItem("impersonate_email");
  if (!email) return null;

  function voltarAdmin() {
    const adminToken = sessionStorage.getItem("admin_token");
    const adminUser = sessionStorage.getItem("admin_user");
    if (adminToken) localStorage.setItem("access_token", adminToken);
    if (adminUser) localStorage.setItem("user", adminUser);
    sessionStorage.removeItem("admin_token");
    sessionStorage.removeItem("admin_user");
    sessionStorage.removeItem("impersonate_email");
    navigate("/admin");
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm font-semibold bg-destructive text-white flex-shrink-0 z-40">
      <span>⚠️ Visualizando como <strong>{email}</strong></span>
      <button
        onClick={voltarAdmin}
        className="ml-4 px-3 py-1 rounded-lg text-xs font-bold bg-white text-destructive hover:bg-red-100 transition-colors"
      >
        ← Voltar para Admin
      </button>
    </div>
  );
}

function BanWaveBanner({ data }) {
  if (!data?.ban_wave?.sistema_pausado) return null;

  const pausadoAte = data.ban_wave.pausado_ate
    ? new Date(data.ban_wave.pausado_ate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="flex items-center justify-between gap-3 px-5 py-3 text-sm font-semibold z-50 flex-shrink-0"
        style={{
          background: "linear-gradient(90deg, #7f1d1d, #991b1b, #7f1d1d)",
          backgroundSize: "200% 100%",
          animation: "banWavePulse 2s ease-in-out infinite",
          boxShadow: "0 0 20px rgba(239,68,68,0.4)",
        }}
      >
        <div className="flex items-center gap-2 text-red-100">
          <ShieldAlert className="h-4 w-4 flex-shrink-0 animate-pulse" />
          <span>
            🚨 Onda de ban detectada! Sistema pausado por segurança.
            {pausadoAte && ` Retoma às ${pausadoAte}.`}
            {" "}({data.ban_wave.bans_ultima_hora} chips banidos na última hora)
          </span>
        </div>
        <span className="text-red-300 text-xs whitespace-nowrap flex-shrink-0">Anti-Ban ativo</span>
      </motion.div>
    </AnimatePresence>
  );
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [antiBan, setAntiBan] = useState(null);
  const location = useLocation();
  const title = pageTitles[location.pathname] || "WahaSaaS";

  // Polling do status anti-ban a cada 30s para detectar ban wave
  useEffect(() => {
    let mounted = true;
    const poll = () => {
      api.get("/antiban/status")
        .then(r => { if (mounted) setAntiBan(r.data) })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <div className="min-h-screen bg-background grid-pattern">
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

      <motion.div
        animate={{ marginLeft: collapsed ? 72 : 260 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      >
        <ImpersonateBanner />
        <BanWaveBanner data={antiBan} />

        {/* Header */}
        <header className="h-16 border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-40 flex items-center justify-between px-8">
          <h1 className="text-lg font-semibold tracking-[-0.03em] text-foreground/90">{title}</h1>
          <div className="flex items-center gap-4">
            {/* Indicador anti-ban compacto no header */}
            {antiBan && !antiBan.ban_wave?.sistema_pausado && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-green-400">
                  {antiBan.protecoes_ativas} proteções
                </span>
              </div>
            )}
            <button className="relative text-muted-foreground hover:text-foreground transition-colors">
              <Bell className="h-5 w-5" />
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-primary border-2 border-background" />
            </button>
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary">
              <User className="h-4 w-4" />
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-8">
          <Outlet />
        </main>
      </motion.div>
    </div>
  );
}
