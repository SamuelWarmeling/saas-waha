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
  grupos_extraidos: { emoji: '✅', bg: 'bg-green-500/15', ring: 'ring-green-500/30' },
  campanha_enviada: { emoji: '📤', bg: 'bg-purple-500/15', ring: 'ring-purple-500/30' },
  sessao_conectada: { emoji: '🟢', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/30' },
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
    api.get('/atividades').then(r => setAtividades(r.data)).catch(() => {})
  }

  useEffect(() => {
    api.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {})
    api.get('/campanhas?page_size=5').then(r => {
      setCampaigns(Array.isArray(r.data) ? r.data : [])
    }).catch(() => {})
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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-500">Visão geral da sua conta</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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

      {/* Chart */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-4">Mensagens nos últimos 7 dias</h2>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorEnv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#9ca3af' }}
              itemStyle={{ color: '#22c55e' }}
            />
            <Area type="monotone" dataKey="enviados" stroke="#22c55e" fill="url(#colorEnv)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Atividade Recente */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
            <MdHistory className="text-base" /> Atividade Recente
          </h2>
          <span className="text-xs text-gray-600">atualiza a cada 10s</span>
        </div>
        {atividades.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-4">Nenhuma atividade registrada ainda.</p>
        ) : (
          <ul className="space-y-3">
            {atividades.map(a => {
              const cfg = tipoConfig[a.tipo] || { emoji: '🔔', bg: 'bg-gray-500/15', ring: 'ring-gray-500/30' }
              const { primary, secondary } = parseAtividade(a)
              const tempo = formatRelativo(a.criado_em)
              const sub = [secondary, tempo].filter(Boolean).join(' • ')
              return (
                <li key={a.id} className="flex items-start gap-3">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full ${cfg.bg} ring-1 ${cfg.ring} flex items-center justify-center text-sm leading-none`}>
                    {cfg.emoji}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm text-gray-100 font-medium leading-snug truncate">{primary}</p>
                    {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Recent campaigns */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-4">Campanhas Recentes</h2>
        {campaigns.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-6">Nenhuma campanha criada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="pb-2 font-medium">Nome</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Contatos</th>
                  <th className="pb-2 font-medium">Enviados</th>
                  <th className="pb-2 font-medium">Sucesso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td className="py-3 text-gray-200 font-medium">{c.name}</td>
                    <td className="py-3">
                      <span className={statusColor[c.status] || 'badge-gray'}>
                        {statusLabel[c.status] || c.status}
                      </span>
                    </td>
                    <td className="py-3 text-gray-400">{c.total_contacts}</td>
                    <td className="py-3 text-gray-400">{c.sent_count}</td>
                    <td className="py-3 text-green-400">{c.success_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
