import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdPeople, MdPhoneAndroid, MdMessage, MdCheckCircle } from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

const PLANS = ['starter', 'pro', 'business']

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    green: 'text-green-400 bg-green-900/30',
    blue: 'text-blue-400 bg-blue-900/30',
    yellow: 'text-yellow-400 bg-yellow-900/30',
    purple: 'text-purple-400 bg-purple-900/30',
  }
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 rounded-xl ${colors[color]}`}>
        <Icon className="text-2xl" />
      </div>
      <div>
        <p className="text-sm text-gray-400">{label}</p>
        <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
      </div>
    </div>
  )
}

export default function Admin() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  // Guard: only admins
  useEffect(() => {
    const raw = localStorage.getItem('user')
    if (raw) {
      try {
        const u = JSON.parse(raw)
        if (!u.is_admin) { navigate('/dashboard', { replace: true }); return }
      } catch { navigate('/dashboard', { replace: true }); return }
    } else {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate])

  const load = useCallback(async () => {
    try {
      const [statsRes, usersRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/usuarios'),
      ])
      setStats(statsRes.data)
      setUsers(usersRes.data)
    } catch {
      toast.error('Erro ao carregar dados admin')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function changePlan(userId, plan) {
    try {
      await api.put(`/admin/usuarios/${userId}/plano`, { plan, days: 30 })
      toast.success('Plano alterado')
      load()
    } catch {
      toast.error('Erro ao alterar plano')
    }
  }

  async function toggleActive(userId, current) {
    try {
      await api.put(`/admin/usuarios/${userId}/ativo`, { is_active: !current })
      toast.success(!current ? 'Usuário ativado' : 'Usuário desativado')
      load()
    } catch {
      toast.error('Erro ao alterar status')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Painel Admin</h1>
        <p className="text-sm text-gray-500">Visão geral de todos os usuários e métricas</p>
      </div>

      {/* Stats globais */}
      {stats && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard icon={MdPeople}      label="Total usuários"   value={stats.total_users}         color="blue"   />
          <StatCard icon={MdCheckCircle} label="Usuários ativos"  value={stats.active_users}        color="green"  />
          <StatCard icon={MdPhoneAndroid} label="Sessões ativas"  value={`${stats.connected_sessions}/${stats.total_sessions}`} color="yellow" />
          <StatCard icon={MdMessage}     label="Msgs hoje"        value={stats.messages_sent_today}  color="purple" />
        </div>
      )}

      {/* Tabela de usuários */}
      <div className="card overflow-x-auto">
        <h2 className="text-base font-semibold text-white mb-4">Usuários</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left pb-2 pr-4">ID</th>
              <th className="text-left pb-2 pr-4">Nome</th>
              <th className="text-left pb-2 pr-4">Email</th>
              <th className="text-left pb-2 pr-4">Plano</th>
              <th className="text-left pb-2 pr-4">Expira</th>
              <th className="text-left pb-2 pr-4">Sessões</th>
              <th className="text-left pb-2 pr-4">Contatos</th>
              <th className="text-left pb-2 pr-4">Status</th>
              <th className="text-left pb-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-3 pr-4 text-gray-500">{u.id}</td>
                <td className="py-3 pr-4 text-white font-medium">
                  {u.name}
                  {u.is_admin && <span className="ml-1 text-xs badge-blue">admin</span>}
                </td>
                <td className="py-3 pr-4 text-gray-400">{u.email}</td>
                <td className="py-3 pr-4">
                  <select
                    value={u.plan}
                    onChange={e => changePlan(u.id, e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1"
                  >
                    {PLANS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </td>
                <td className="py-3 pr-4 text-gray-400 text-xs">
                  {u.plan_expires_at
                    ? new Date(u.plan_expires_at).toLocaleDateString('pt-BR')
                    : '—'}
                </td>
                <td className="py-3 pr-4 text-gray-400">{u.sessions_count}</td>
                <td className="py-3 pr-4 text-gray-400">{u.contacts_count}</td>
                <td className="py-3 pr-4">
                  <span className={u.is_active ? 'badge-green' : 'badge-red'}>
                    {u.is_active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="py-3">
                  <button
                    onClick={() => toggleActive(u.id, u.is_active)}
                    className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                      u.is_active
                        ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
                        : 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                    }`}
                  >
                    {u.is_active ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="text-center text-gray-500 py-8">Nenhum usuário encontrado.</p>
        )}
      </div>
    </div>
  )
}
