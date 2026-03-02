import { useEffect, useState, useRef } from 'react'
import {
  MdContacts, MdSend, MdPhoneAndroid, MdCampaign, MdHistory,
} from 'react-icons/md'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import Stats from '../components/Stats'
import api from '../api'

const tipoConfig = {
  contato_extraido: { emoji: '📱', bg: 'bg-blue-500/15', ring: 'ring-blue-500/30' },
  grupos_extraidos: { emoji: '✅', bg: 'bg-primary-500/15', ring: 'ring-primary-500/30' },
  campanha_enviada: { emoji: '📤', bg: 'bg-purple-500/15', ring: 'ring-purple-500/30' },
  sessao_conectada: { emoji: '🟢', bg: 'bg-primary-500/15', ring: 'ring-primary-500/30' },
}

function formatRelativo(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000)
  if (diff < 60) return `${diff}s atrás`
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`
  return `${Math.floor(diff / 86400)}d atrás`
}

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4)
    const num = digits.slice(4)
    if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`
    if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`
  }
  return raw
}

function parseAtividade(a) {
  const { tipo, descricao } = a

  if (tipo === 'contato_extraido') {
    // "Contato extraído: 5511999999999 via sessão u1_01"
    const m = descricao.match(/^Contato extraído: (.+) via sessão (.+)$/)
    if (m) {
      const [, identifier, session] = m
      const isPhone = /^\d{10,}$/.test(identifier)
      const display = isPhone ? formatPhone(identifier) : identifier
      return { primary: `${display} extraído`, secondary: `via sessão ${session}` }
    }
  }

  if (tipo === 'grupos_extraidos') {
    // "Extração seletiva: 3 grupos selecionados, 370 membros salvos (...)"
    const m = descricao.match(/(\d+) grupos selecionados, (\d+) membros salvos/)
    if (m) {
      const [, grupos, membros] = m
      const g = Number(grupos)
      return {
        primary: `${membros} contatos extraídos`,
        secondary: `${g} grupo${g !== 1 ? 's' : ''} selecionado${g !== 1 ? 's' : ''}`,
      }
    }
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

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [atividades, setAtividades] = useState([])
  const intervalRef = useRef(null)

  function loadAtividades() {
    api.get('/atividades').then(r => setAtividades(r.data)).catch(() => { })
  }

  useEffect(() => {
    api.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => { })
    api.get('/campanhas?page_size=5').then(r => {
      setCampaigns(Array.isArray(r.data) ? r.data : [])
    }).catch(() => { })
    loadAtividades()
    intervalRef.current = setInterval(loadAtividades, 10000)
    return () => clearInterval(intervalRef.current)
  }, [])

  const chartData = stats?.chart ?? []
  const activeCampaigns = campaigns.filter(c => c.status === 'running').length

  const statusColor = {
    running: 'badge-green',
    paused: 'badge-yellow',
    completed: 'badge-blue',
    draft: 'badge-gray',
    cancelled: 'badge-red',
  }
  const statusLabel = {
    running: 'Ativo',
    paused: 'Pausado',
    completed: 'Concluído',
    draft: 'Rascunho',
    cancelled: 'Cancelado',
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Dashboard</h1>
        <p className="text-sm text-surface-400 mt-1">Visão geral da sua conta</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          {/* Chart */}
          <div className="glass-card">
            <h2 className="text-sm font-semibold text-surface-300 mb-6">Mensagens nos últimos 7 dias</h2>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorEnv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} dy={10} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' }}
                  labelStyle={{ color: '#cbd5e1', fontWeight: 600, paddingBottom: 4 }}
                  itemStyle={{ color: '#a78bfa', fontWeight: 500 }}
                  cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '4 4' }}
                />
                <Area type="monotone" dataKey="enviados" stroke="#8b5cf6" fill="url(#colorEnv)" strokeWidth={3} activeDot={{ r: 6, fill: '#8b5cf6', stroke: '#fff', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Recent campaigns */}
          <div className="glass-card">
            <h2 className="text-sm font-semibold text-surface-300 mb-6">Campanhas Recentes</h2>
            {campaigns.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-full bg-surface-800/50 flex items-center justify-center mb-4">
                  <MdCampaign className="text-3xl text-surface-500" />
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

        {/* Sidebar Space */}
        <div className="space-y-6">
          {/* Atividade Recente */}
          <div className="glass-card min-h-[400px]">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-surface-700/50">
              <h2 className="text-sm font-semibold text-surface-100 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
                  <MdHistory className="text-lg" />
                </div>
                Atividade da Conta
              </h2>
            </div>
            {atividades.length === 0 ? (
              <div className="py-10 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-surface-800/40 flex items-center justify-center mb-3">
                  <span className="w-2 h-2 rounded-full bg-surface-500 animate-pulse"></span>
                </div>
                <p className="text-surface-500 text-xs font-medium">Aguardando atividades...</p>
              </div>
            ) : (
              <ul className="space-y-4 pr-1 max-h-[500px] overflow-y-auto custom-scrollbar">
                {atividades.map(a => {
                  const cfg = tipoConfig[a.tipo] || { emoji: '🔔', bg: 'bg-surface-700/30', ring: 'ring-surface-600/50' }
                  const { primary, secondary } = parseAtividade(a)
                  const tempo = formatRelativo(a.criado_em)

                  return (
                    <li key={a.id} className="flex items-start gap-3.5 group p-2 rounded-lg hover:bg-surface-800/40 transition-colors">
                      <div className={`flex-shrink-0 w-10 h-10 mt-0.5 rounded-xl ${cfg.bg} ring-1 ${cfg.ring} flex items-center justify-center text-base shadow-sm group-hover:scale-105 transition-transform`}>
                        {cfg.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-surface-200 font-medium leading-snug line-clamp-2">{primary}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {secondary && <span className="text-[11px] text-surface-400 truncate max-w-[120px]">{secondary}</span>}
                          {secondary && <span className="w-1 h-1 rounded-full bg-surface-600"></span>}
                          <span className="text-[10px] uppercase font-semibold text-primary-400/80 tracking-wider pt-0.5 inline-block">{tempo}</span>
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
