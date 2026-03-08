import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MdContacts, MdSend, MdPhoneAndroid, MdCampaign, MdHistory,
  MdWarning, MdTrendingUp, MdTrendingDown, MdCheckCircle,
  MdSchedule, MdBarChart, MdStar, MdFilterAlt,
} from 'react-icons/md'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import Stats from '../components/Stats'
import api from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

const tipoConfig = {
  contato_extraido:  { emoji: '📱', bg: 'bg-blue-500/15',    ring: 'ring-blue-500/30' },
  grupos_extraidos:  { emoji: '✅', bg: 'bg-primary-500/15', ring: 'ring-primary-500/30' },
  campanha_enviada:  { emoji: '📤', bg: 'bg-purple-500/15',  ring: 'ring-purple-500/30' },
  sessao_conectada:  { emoji: '🟢', bg: 'bg-primary-500/15', ring: 'ring-primary-500/30' },
  grupo_auto_atualizado:    { emoji: '🔄', bg: 'bg-indigo-500/15',  ring: 'ring-indigo-500/30' },
  funnel_respondeu:         { emoji: '💬', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/30' },
  funnel_mensagem_enviada:  { emoji: '🎯', bg: 'bg-purple-500/15',  ring: 'ring-purple-500/30' },
}

function formatRelativo(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000)
  if (diff < 60) return `${diff}s atrás`
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`
  return `${Math.floor(diff / 86400)}d atrás`
}

function fmtScheduled(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function parseAtividade(a) {
  const { tipo, descricao } = a
  if (tipo === 'contato_extraido') {
    const m = descricao.match(/^Contato extraído: (.+) via sessão (.+)$/)
    if (m) {
      const digits = m[1].replace(/\D/g, '')
      const display = digits.length >= 10
        ? (() => { const ddd = digits.slice(2, 4); const n = digits.slice(4); return n.length === 9 ? `(${ddd}) ${n.slice(0,5)}-${n.slice(5)}` : m[1] })()
        : m[1]
      return { primary: `${display} extraído`, secondary: `via ${m[2]}` }
    }
  }
  if (tipo === 'grupos_extraidos') {
    const m = descricao.match(/(\d+) grupos selecionados, (\d+) membros salvos/)
    if (m) return { primary: `${m[2]} contatos extraídos`, secondary: `${m[1]} grupo(s)` }
  }
  if (tipo === 'campanha_enviada') {
    const m = descricao.match(/Campanha[: ]+"?(.+?)"? enviada?/i)
    if (m) return { primary: `Campanha "${m[1]}" enviada`, secondary: '' }
  }
  if (tipo === 'sessao_conectada') {
    const m = descricao.match(/Sessão (.+) conectada/i)
    if (m) return { primary: `Sessão ${m[1]} conectada`, secondary: '' }
  }
  return { primary: descricao, secondary: '' }
}

// ── Tooltip customizado do gráfico ─────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#120e1e', border: '1px solid rgba(157,78,221,0.2)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>
      <p className="text-surface-300 font-semibold text-xs mb-2">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-xs font-medium" style={{ color: p.color }}>
          {p.name === 'enviados' ? '📤' : '📥'} {p.name === 'enviados' ? 'Enviados' : 'Extraídos'}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [atividades, setAtividades] = useState([])
  const [funnelStats, setFunnelStats] = useState(null)
  const activityRef = useRef(null)
  const sessionsRef = useRef(null)

  const loadStats = useCallback(() => {
    api.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {})
  }, [])

  const loadAtividades = useCallback(() => {
    api.get('/atividades').then(r => setAtividades(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    loadStats()
    api.get('/campanhas?page_size=5').then(r => setCampaigns(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    loadAtividades()
    api.get('/funnel/stats').then(r => setFunnelStats(r.data)).catch(() => {})

    // Activity polling: 10s
    activityRef.current = setInterval(loadAtividades, 10000)
    // Session/stats polling: 30s
    sessionsRef.current = setInterval(loadStats, 30000)

    return () => {
      clearInterval(activityRef.current)
      clearInterval(sessionsRef.current)
    }
  }, [loadStats, loadAtividades])

  // ── Dados derivados ────────────────────────────────────────────────────────
  const chartData = stats?.chart ?? []
  const activeCampaigns = campaigns.filter(c => c.status === 'running').length

  // Chips desconectados (were once connected, now not)
  const disconnectedChips = (stats?.sessoes_detalhes ?? []).filter(
    s => !['connected', 'working'].includes(s.status?.toLowerCase())
  )
  const hasDisconnected = disconnectedChips.length > 0

  const contatosHoje = stats?.contatos_hoje ?? 0
  const contatosOntem = stats?.contatos_ontem ?? 0
  const contatosDiff = contatosHoje - contatosOntem
  const taxaEntrega = stats?.taxa_entrega ?? 0
  const taxaErro = stats?.taxa_erro ?? 0

  const statusColor = { running: 'badge-green', paused: 'badge-yellow', completed: 'badge-blue', draft: 'badge-gray', cancelled: 'badge-red', scheduled: 'badge-yellow' }
  const statusLabel = { running: 'Ativo', paused: 'Pausado', completed: 'Concluído', draft: 'Rascunho', cancelled: 'Cancelado', scheduled: 'Agendada' }

  return (
    <div className="space-y-6">

      {/* ── Banner de alerta de chips desconectados ─────────────────────────── */}
      {hasDisconnected && (
        <div className="rounded-2xl border border-orange-500/40 bg-orange-950/30 px-5 py-4 flex flex-wrap items-center gap-4" style={{ boxShadow: '0 0 30px rgba(249,115,22,0.1)' }}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center flex-shrink-0">
              <MdWarning size={22} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-orange-300 text-sm">
                {disconnectedChips.length === 1
                  ? `Chip "${disconnectedChips[0].name}" desconectou!`
                  : `${disconnectedChips.length} chips desconectados!`}
              </p>
              <p className="text-xs text-orange-400/70 mt-0.5">
                {disconnectedChips.length === 1
                  ? 'Reconecte para não interromper campanhas em andamento.'
                  : disconnectedChips.map(c => c.name).join(', ')}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/sessoes')}
            className="flex-shrink-0 px-4 py-2 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-300 text-sm font-bold hover:bg-orange-500/35 transition-all"
          >
            Reconectar agora →
          </button>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Dashboard</h1>
        <p className="text-sm text-surface-400 mt-1">Visão geral da sua conta</p>
      </div>

      {/* ── Stats grid (6 cards) ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <Stats
          title="Total de Contatos"
          value={stats ? stats.total_contatos.toLocaleString('pt-BR') : '–'}
          icon={MdContacts}
          color="blue"
        />
        <Stats
          title="Total de Campanhas"
          value={stats ? stats.total_campanhas.toLocaleString('pt-BR') : '–'}
          icon={MdSend}
          color="green"
        />
        <Stats
          title="Sessões Ativas"
          value={stats ? `${stats.sessoes_ativas}/${stats.sessoes_total}` : '–'}
          sub="conectadas"
          icon={MdPhoneAndroid}
          color="yellow"
        />
        <Stats
          title="Campanhas Rodando"
          value={activeCampaigns}
          icon={MdCampaign}
          color="purple"
        />

        {/* Card Contatos Hoje */}
        <div className="glass-card flex items-start gap-4">
          <div className={`p-3.5 rounded-2xl flex items-center justify-center ${contatosDiff >= 0 ? 'bg-primary-900/30 text-primary-400 border border-primary-500/20' : 'bg-red-900/30 text-red-400 border border-red-500/20'}`}>
            {contatosDiff >= 0 ? <MdTrendingUp className="text-2xl" /> : <MdTrendingDown className="text-2xl" />}
          </div>
          <div className="flex-1 min-w-0 py-1">
            <p className="text-sm font-medium text-surface-400 tracking-wide">Contatos Hoje</p>
            <p className="text-2xl font-bold text-surface-50 mt-1 tracking-tight">{stats ? contatosHoje.toLocaleString('pt-BR') : '–'}</p>
            {stats && (
              <p className={`text-xs font-semibold mt-1.5 flex items-center gap-1 ${contatosDiff >= 0 ? 'text-primary-400' : 'text-red-400'}`}>
                {contatosDiff >= 0 ? '+' : ''}{contatosDiff} vs ontem
              </p>
            )}
          </div>
        </div>

        {/* Card Taxa de Entrega */}
        <div className="glass-card flex items-start gap-4">
          <div className="p-3.5 rounded-2xl bg-primary-900/30 text-primary-400 border border-primary-500/20 flex items-center justify-center">
            <MdCheckCircle className="text-2xl" />
          </div>
          <div className="flex-1 min-w-0 py-1">
            <p className="text-sm font-medium text-surface-400 tracking-wide">Taxa de Entrega</p>
            <p className="text-2xl font-bold text-surface-50 mt-1 tracking-tight">
              {stats ? `${taxaEntrega}%` : '–'}
            </p>
            {stats && (
              <>
                <div className="mt-2 h-1.5 rounded-full bg-surface-800 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all duration-700"
                    style={{ width: `${taxaEntrega}%` }} />
                </div>
                <p className="text-xs font-medium text-surface-500 mt-1.5">{taxaErro}% erro</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Main layout ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Coluna principal (col-span-2) */}
        <div className="lg:col-span-2 space-y-6">

          {/* Gráfico 7 dias com 2 linhas */}
          <div className="glass-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-surface-300">Últimos 7 dias</h2>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-400">
                  <div className="w-3 h-0.5 rounded-full bg-primary-500" /> Enviados
                </span>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                  <div className="w-3 h-0.5 rounded-full bg-emerald-500" /> Extraídos
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradEnv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#9D4EDD" stopOpacity={0.40} />
                    <stop offset="95%" stopColor="#9D4EDD" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradExt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d2244" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} dy={8} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#3d3058', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area
                  type="monotone" dataKey="enviados" stroke="#9D4EDD" fill="url(#gradEnv)"
                  strokeWidth={2.5}
                  activeDot={{ r: 5, fill: '#9D4EDD', stroke: '#0B0914', strokeWidth: 2 }}
                />
                <Area
                  type="monotone" dataKey="extraidos" stroke="#10b981" fill="url(#gradExt)"
                  strokeWidth={2}
                  activeDot={{ r: 5, fill: '#10b981', stroke: '#0B0914', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Gráfico DDDs */}
          <div className="glass-card">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center flex-shrink-0">
                <MdBarChart size={18} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-surface-100">Top DDDs da base</h2>
                <p className="text-[11px] text-surface-500 mt-0.5">Concentração de contatos por região</p>
              </div>
            </div>
            {!stats || stats.top_ddds.length === 0 ? (
              <p className="text-surface-500 text-xs py-6 text-center">Nenhum dado disponível</p>
            ) : (
              <div className="space-y-2.5">
                {stats.top_ddds.map((row, i) => (
                  <div key={row.ddd} className="flex items-center gap-3">
                    <div className="w-6 text-[11px] font-bold text-surface-500 text-right flex-shrink-0">{i + 1}</div>
                    <div className="w-8 text-center flex-shrink-0">
                      <span className="text-xs font-black text-primary-300 bg-primary-900/30 border border-primary-500/20 px-1.5 py-0.5 rounded-md">{row.ddd}</span>
                    </div>
                    <div className="w-6 text-[10px] text-surface-500 flex-shrink-0">{row.estado}</div>
                    <div className="flex-1 h-2 rounded-full bg-surface-800/60 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${row.pct}%`,
                          background: `linear-gradient(90deg, #9d4edd ${100 - row.pct}%, #6a0dad)`,
                          opacity: 0.7 + (row.pct / 300),
                        }}
                      />
                    </div>
                    <div className="w-14 text-right text-[11px] font-semibold text-surface-300 flex-shrink-0">
                      {row.count.toLocaleString('pt-BR')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Campanhas recentes */}
          <div className="glass-card">
            <h2 className="text-sm font-semibold text-surface-300 mb-5">Campanhas Recentes</h2>
            {campaigns.length === 0 ? (
              <div className="py-10 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-full bg-surface-800/50 flex items-center justify-center mb-3">
                  <MdCampaign className="text-2xl text-surface-500" />
                </div>
                <p className="text-surface-400 text-sm font-medium">Nenhuma campanha criada ainda.</p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-surface-400 border-b border-surface-700/50">
                      <th className="pb-3 font-medium whitespace-nowrap">Nome</th>
                      <th className="pb-3 font-medium px-4">Status</th>
                      <th className="pb-3 font-medium text-right px-4">Contatos</th>
                      <th className="pb-3 font-medium text-right px-4">Enviados</th>
                      <th className="pb-3 font-medium text-right">Sucesso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800/50">
                    {campaigns.map(c => (
                      <tr key={c.id} className="hover:bg-surface-800/30 transition-colors">
                        <td className="py-3.5 text-surface-100 font-medium whitespace-nowrap">{c.name}</td>
                        <td className="py-3.5 px-4">
                          <span className={statusColor[c.status] || 'badge-gray'}>
                            {statusLabel[c.status] || c.status}
                          </span>
                        </td>
                        <td className="py-3.5 text-surface-400 text-right px-4">{c.total_contacts.toLocaleString('pt-BR')}</td>
                        <td className="py-3.5 text-surface-400 text-right px-4">{c.sent_count.toLocaleString('pt-BR')}</td>
                        <td className="py-3.5 text-primary-400 font-medium text-right">
                          {c.total_contacts > 0 ? Math.round((c.success_count / c.total_contacts) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Top Chip do Mês */}
          <div className="glass-card">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-surface-700/50">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <MdStar size={18} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-surface-100">Top Chip do Mês</h2>
                <p className="text-[10px] text-surface-500">Chip mais ativo em disparos</p>
              </div>
            </div>
            {!stats?.top_chip ? (
              <p className="text-surface-500 text-xs text-center py-4">Sem dados de disparo este mês</p>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
                    <MdPhoneAndroid className="text-amber-400" size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-surface-100 text-sm truncate">{stats.top_chip.name}</p>
                    {stats.top_chip.phone_number && (
                      <p className="text-[11px] text-surface-500 font-mono mt-0.5">{stats.top_chip.phone_number}</p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-surface-400">Disparos no mês</span>
                    <span className="font-bold text-amber-400">{stats.top_chip.sent_mes.toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-800/60 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.min(100, Math.round(stats.top_chip.sent_mes / stats.top_chip.max_daily * 100))}%`,
                        background: 'linear-gradient(90deg, #f59e0b, #d97706)',
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-surface-500">Limite diário: {stats.top_chip.max_daily.toLocaleString('pt-BR')} msg/dia</p>
                </div>
              </>
            )}
          </div>

          {/* Próximas campanhas agendadas */}
          <div className="glass-card">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-surface-700/50">
              <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
                <MdSchedule size={18} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-surface-100">Agendamentos</h2>
                <p className="text-[10px] text-surface-500">Próximas campanhas programadas</p>
              </div>
            </div>
            {!stats || stats.campanhas_agendadas.length === 0 ? (
              <p className="text-surface-500 text-xs text-center py-4">Nenhuma campanha agendada</p>
            ) : (
              <ul className="space-y-3">
                {stats.campanhas_agendadas.map(c => (
                  <li key={c.id} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-surface-800/30 transition-colors border border-surface-800/40">
                    <div className="w-8 h-8 rounded-lg bg-primary-900/30 border border-primary-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <MdCampaign size={16} className="text-primary-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-surface-200 truncate">{c.name}</p>
                      <p className="text-[11px] text-primary-400/80 mt-0.5 flex items-center gap-1">
                        <MdSchedule size={11} /> {fmtScheduled(c.scheduled_at)}
                      </p>
                      <p className="text-[10px] text-surface-500 mt-0.5">{c.total_contacts.toLocaleString('pt-BR')} contatos</p>
                    </div>
                    <span className="badge-primary text-[10px] flex-shrink-0 mt-0.5">Agendada</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Card Funil de Leads */}
          <div className="glass-card">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-surface-700/50">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(157,78,221,0.2)', color: '#9D4EDD' }}>
                <MdFilterAlt size={18} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-surface-100">Funil de Leads 🎯</h2>
                <p className="text-[10px] text-surface-500">Recuperação automática</p>
              </div>
            </div>
            {!funnelStats || funnelStats.total_sequencias === 0 ? (
              <div className="py-4 text-center">
                <p className="text-surface-500 text-xs mb-2">Nenhuma sequência ativa</p>
                <button onClick={() => navigate('/funil')} className="text-xs font-semibold text-primary-300 hover:text-primary-200 underline underline-offset-2">
                  Criar sequência →
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
                    <div className="text-xl font-bold text-blue-400">{funnelStats.total_ativos}</div>
                    <div className="text-[10px] text-surface-500">Em andamento</div>
                  </div>
                  <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
                    <div className="text-xl font-bold text-yellow-400">{funnelStats.total_convertidos}</div>
                    <div className="text-[10px] text-surface-500">Convertidos</div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px] text-surface-400">Taxa de conversão</span>
                    <span className="text-[11px] font-bold text-yellow-400">{funnelStats.taxa_conversao}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-800/60 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${funnelStats.taxa_conversao}%`, background: 'linear-gradient(90deg, #9D4EDD, #eab308)' }}
                    />
                  </div>
                  <p className="text-[10px] text-surface-500 mt-1.5">{funnelStats.total_sequencias} sequência(s) · {funnelStats.total_contatos} leads</p>
                </div>
                <button onClick={() => navigate('/funil')} className="w-full text-center text-xs font-semibold text-primary-300 hover:text-primary-200 py-1 transition-colors">
                  Ver funil completo →
                </button>
              </div>
            )}
          </div>

          {/* Atividade Recente */}
          <div className="glass-card">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-surface-700/50">
              <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
                <MdHistory size={18} />
              </div>
              <h2 className="text-sm font-semibold text-surface-100">Atividade da Conta</h2>
            </div>
            {atividades.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-10 h-10 mx-auto rounded-full bg-surface-800/40 flex items-center justify-center mb-3">
                  <span className="w-2 h-2 rounded-full bg-surface-500 animate-pulse" />
                </div>
                <p className="text-surface-500 text-xs font-medium">Aguardando atividades...</p>
              </div>
            ) : (
              <ul className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {atividades.map(a => {
                  const cfg = tipoConfig[a.tipo] || { emoji: '🔔', bg: 'bg-surface-700/30', ring: 'ring-surface-600/50' }
                  const { primary, secondary } = parseAtividade(a)
                  const tempo = formatRelativo(a.criado_em)
                  return (
                    <li key={a.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-surface-800/40 transition-colors group">
                      <div className={`flex-shrink-0 w-9 h-9 mt-0.5 rounded-xl ${cfg.bg} ring-1 ${cfg.ring} flex items-center justify-center text-sm shadow-sm group-hover:scale-105 transition-transform`}>
                        {cfg.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-surface-200 font-medium leading-snug line-clamp-2">{primary}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {secondary && <span className="text-[10px] text-surface-400 truncate max-w-[100px]">{secondary}</span>}
                          {secondary && <span className="w-1 h-1 rounded-full bg-surface-600" />}
                          <span className="text-[10px] uppercase font-semibold text-primary-400/80 tracking-wider">{tempo}</span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
