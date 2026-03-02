import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdPeople, MdPhoneAndroid, MdMessage, MdCheckCircle } from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

const PLANS = ['starter', 'pro', 'business']

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    green: 'text-primary-400 bg-primary-900/30',
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
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Painel Admin</h1>
        <p className="text-sm text-surface-400 mt-1">Visão geral de todos os usuários e métricas</p>
      </div>

      {/* Stats globais */}
      {stats && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-6">
          <StatCard icon={MdPeople} label="Total usuários" value={stats.total_users} color="blue" />
          <StatCard icon={MdCheckCircle} label="Usuários ativos" value={stats.active_users} color="green" />
          <StatCard icon={MdPhoneAndroid} label="Sessões ativas" value={`${stats.connected_sessions}/${stats.total_sessions}`} color="yellow" />
          <StatCard icon={MdMessage} label="Msgs hoje" value={stats.messages_sent_today} color="purple" />
        </div>
      )}

      {/* Tabela de usuários */}
      <div className="glass-card overflow-x-auto">
        <h2 className="text-sm font-semibold text-surface-300 mb-6">Administrar Usuários</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-surface-400 border-b border-surface-700/50">
              <th className="font-medium pb-3 pr-4">ID</th>
              <th className="font-medium pb-3 pr-4">Nome & Email</th>
              <th className="font-medium pb-3 pr-4">Plano</th>
              <th className="font-medium pb-3 pr-4">Status & Métricas</th>
              <th className="font-medium pb-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800/50">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-surface-800/30 transition-colors">
                <td className="py-4 pr-4 text-surface-500 font-mono text-xs">{u.id}</td>
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-2">
                    <p className="text-surface-100 font-medium">
                      {u.name}
                      {u.is_admin && <span className="ml-2 badge-primary">admin</span>}
                    </p>
                  </div>
                  <p className="text-surface-400 text-xs mt-0.5">{u.email}</p>
                </td>
                <td className="py-4 pr-4">
                  <div className="flex flex-col gap-1.5">
                    <select
                      value={u.plan}
                      onChange={e => changePlan(u.id, e.target.value)}
                      className="bg-surface-900/50 border border-surface-700 text-surface-100 text-xs rounded-lg px-2 py-1.5 w-max focus:ring-1 focus:ring-primary-500 outline-none"
                    >
                      {PLANS.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-surface-500 font-mono">
                      Vence em: {u.plan_expires_at ? new Date(u.plan_expires_at).toLocaleDateString('pt-BR') : '—'}
                    </span>
                  </div>
                </td>
                <td className="py-4 pr-4">
                  <div className="flex flex-col gap-2">
                    <span className={`w-max ${u.is_active ? 'badge-green' : 'badge-red'}`}>
                      {u.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                    <div className="flex items-center gap-3 text-[11px] text-surface-400 font-medium">
                      <span className="flex items-center gap-1" title="Sessões">
                        <MdPhoneAndroid className="text-primary-500" /> {u.sessions_count}
                      </span>
                      <span className="flex items-center gap-1" title="Contatos">
                        <MdPeople className="text-blue-500" /> {u.contacts_count}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="py-4 text-right">
                  <button
                    onClick={() => toggleActive(u.id, u.is_active)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${u.is_active
                        ? 'bg-red-900/20 text-red-400 hover:bg-red-600 hover:text-white border border-red-500/20'
                        : 'bg-primary-900/20 text-primary-400 hover:bg-primary-600 hover:text-white border border-primary-500/20'
                      }`}
                  >
                    {u.is_active ? 'Desativar' : 'Ativar Conta'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-surface-800/50 flex items-center justify-center mb-4">
              <MdPeople className="text-3xl text-surface-500" />
            </div>
            <p className="text-surface-400 text-sm font-medium">Nenhum usuário encontrado.</p>
          </div>
        )}
      </div>
    </div>
  )
}
