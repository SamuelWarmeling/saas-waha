import { useEffect, useState } from 'react'
import {
  MdContacts, MdSend, MdCheckCircle, MdPhoneAndroid, MdCampaign,
} from 'react-icons/md'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import Stats from '../components/Stats'
import api from '../api'

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [sessions, setSessions] = useState([])

  useEffect(() => {
    Promise.all([
      api.get('/contatos?page_size=1').catch(() => ({ data: { total: 0 } })),
      api.get('/campanhas?page_size=5').catch(() => ({ data: [] })),
      api.get('/sessoes').catch(() => ({ data: [] })),
    ]).then(([contacts, camps, sess]) => {
      setData({ totalContacts: contacts.data.total })
      setCampaigns(Array.isArray(camps.data) ? camps.data : [])
      setSessions(Array.isArray(sess.data) ? sess.data : [])
    })
  }, [])

  const connectedSessions = sessions.filter(s => s.status === 'connected').length
  const todaySent = campaigns.reduce((acc, c) => acc + (c.success_count || 0), 0)
  const activeCampaigns = campaigns.filter(c => c.status === 'running').length

  const chartData = [
    { name: 'Seg', enviados: 120 },
    { name: 'Ter', enviados: 185 },
    { name: 'Qua', enviados: 210 },
    { name: 'Qui', enviados: 95 },
    { name: 'Sex', enviados: 240 },
    { name: 'Sáb', enviados: 180 },
    { name: 'Dom', enviados: 60 },
  ]

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
          value={data?.totalContacts?.toLocaleString('pt-BR') ?? '–'}
          icon={MdContacts}
          color="blue"
        />
        <Stats
          title="Mensagens Hoje"
          value={todaySent.toLocaleString('pt-BR')}
          sub="soma das campanhas"
          icon={MdSend}
          color="green"
        />
        <Stats
          title="Sessões Ativas"
          value={`${connectedSessions}/${sessions.length}`}
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
