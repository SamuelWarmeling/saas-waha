import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdPeople, MdPhoneAndroid, MdMessage, MdCheckCircle, MdSecurity, MdBlock, MdWarning } from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

const PLANS = ['starter', 'pro', 'business']

const TIPO_LABELS = {
  email_bloqueado: { label: 'Email temporário', color: 'text-yellow-400 bg-yellow-900/20' },
  cpf_duplicado: { label: 'CPF duplicado', color: 'text-orange-400 bg-orange-900/20' },
  rate_limit: { label: 'Rate limit IP', color: 'text-red-400 bg-red-900/20' },
  ip_banido: { label: 'IP banido', color: 'text-red-500 bg-red-900/30' },
}

function SecurityTab() {
  const [ips, setIps] = useState([])
  const [tentativas, setTentativas] = useState([])
  const [banidos, setBanidos] = useState([])
  const [loadingSeg, setLoadingSeg] = useState(true)
  const [banirIP, setBanirIP] = useState('')
  const [banirMotivo, setBanirMotivo] = useState('')

  const loadSecurity = useCallback(async () => {
    setLoadingSeg(true)
    try {
      const [ipsRes, tentRes, banRes] = await Promise.all([
        api.get('/admin/seguranca/ips'),
        api.get('/admin/seguranca/tentativas'),
        api.get('/admin/seguranca/banidos'),
      ])
      setIps(ipsRes.data)
      setTentativas(tentRes.data)
      setBanidos(banRes.data)
    } catch {
      toast.error('Erro ao carregar dados de segurança')
    } finally {
      setLoadingSeg(false)
    }
  }, [])

  useEffect(() => { loadSecurity() }, [loadSecurity])

  async function handleBanir(ip, motivo) {
    try {
      await api.post('/admin/seguranca/banir', { ip, motivo })
      toast.success(`IP ${ip} banido`)
      loadSecurity()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao banir IP')
    }
  }

  async function handleDesbanir(ip) {
    try {
      await api.delete(`/admin/seguranca/banir/${ip}`)
      toast.success(`IP ${ip} desbanido`)
      loadSecurity()
    } catch {
      toast.error('Erro ao desbanir IP')
    }
  }

  if (loadingSeg) return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
    </div>
  )

  const banidosSet = new Set(banidos.map(b => b.ip))

  return (
    <div className="space-y-6">
      {/* Banir IP manualmente */}
      <div className="glass-card">
        <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
          <MdBlock className="text-red-400" /> Banir IP manualmente
        </h3>
        <div className="flex gap-3">
          <input
            value={banirIP}
            onChange={e => setBanirIP(e.target.value)}
            placeholder="Ex: 192.168.1.1"
            className="bg-surface-900/50 border border-surface-700 text-surface-100 rounded-lg px-3 py-2 text-sm flex-1 focus:ring-1 focus:ring-primary-500 outline-none"
          />
          <input
            value={banirMotivo}
            onChange={e => setBanirMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            className="bg-surface-900/50 border border-surface-700 text-surface-100 rounded-lg px-3 py-2 text-sm flex-1 focus:ring-1 focus:ring-primary-500 outline-none"
          />
          <button
            onClick={() => { if (banirIP) { handleBanir(banirIP, banirMotivo); setBanirIP(''); setBanirMotivo('') } }}
            className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Banir
          </button>
        </div>
      </div>

      {/* IPs banidos */}
      {banidos.length > 0 && (
        <div className="glass-card overflow-x-auto">
          <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
            <MdBlock className="text-red-400" /> IPs banidos ({banidos.length})
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-surface-400 border-b border-surface-700/50">
                <th className="font-medium pb-2 pr-4">IP</th>
                <th className="font-medium pb-2 pr-4">Motivo</th>
                <th className="font-medium pb-2 pr-4">Banido em</th>
                <th className="font-medium pb-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/50">
              {banidos.map(b => (
                <tr key={b.id} className="hover:bg-surface-800/20">
                  <td className="py-3 pr-4 font-mono text-red-400">{b.ip}</td>
                  <td className="py-3 pr-4 text-surface-400 text-xs">{b.motivo || '—'}</td>
                  <td className="py-3 pr-4 text-surface-500 text-xs">{b.banido_em ? new Date(b.banido_em).toLocaleString('pt-BR') : '—'}</td>
                  <td className="py-3 text-right">
                    <button onClick={() => handleDesbanir(b.ip)} className="text-xs text-green-400 hover:text-green-300 font-medium">
                      Desbanir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabela de IPs com cadastros */}
      <div className="glass-card overflow-x-auto">
        <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
          <MdWarning className="text-yellow-400" /> Cadastros por IP (top 100)
        </h3>
        {ips.length === 0 ? (
          <p className="text-surface-500 text-sm py-4 text-center">Nenhum registro.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-surface-400 border-b border-surface-700/50">
                <th className="font-medium pb-2 pr-4">IP</th>
                <th className="font-medium pb-2 pr-4">Data</th>
                <th className="font-medium pb-2 pr-4">Cadastros</th>
                <th className="font-medium pb-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/50">
              {ips.map((r, i) => (
                <tr key={i} className={`hover:bg-surface-800/20 ${r.banido ? 'opacity-50' : ''}`}>
                  <td className="py-3 pr-4 font-mono text-surface-200">{r.ip}</td>
                  <td className="py-3 pr-4 text-surface-500 text-xs">{r.data}</td>
                  <td className="py-3 pr-4">
                    <span className={`font-bold ${r.contagem >= 3 ? 'text-red-400' : r.contagem >= 2 ? 'text-yellow-400' : 'text-surface-300'}`}>
                      {r.contagem}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {r.banido ? (
                      <button onClick={() => handleDesbanir(r.ip)} className="text-xs text-green-400 hover:text-green-300">Desbanir</button>
                    ) : (
                      <button onClick={() => handleBanir(r.ip, 'Abuso de cadastros')} className="text-xs text-red-400 hover:text-red-300">Banir</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tentativas suspeitas */}
      <div className="glass-card overflow-x-auto">
        <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
          <MdSecurity className="text-cyan-400" /> Tentativas bloqueadas (últimas 200)
        </h3>
        {tentativas.length === 0 ? (
          <p className="text-surface-500 text-sm py-4 text-center">Nenhuma tentativa registrada.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-surface-400 border-b border-surface-700/50">
                <th className="font-medium pb-2 pr-4">Tipo</th>
                <th className="font-medium pb-2 pr-4">IP</th>
                <th className="font-medium pb-2 pr-4">Detalhe</th>
                <th className="font-medium pb-2 text-right">Quando</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/50">
              {tentativas.map(t => {
                const tipo = TIPO_LABELS[t.tipo] || { label: t.tipo, color: 'text-surface-400 bg-surface-800' }
                return (
                  <tr key={t.id} className="hover:bg-surface-800/20">
                    <td className="py-3 pr-4">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${tipo.color}`}>{tipo.label}</span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-surface-400">{t.ip || '—'}</td>
                    <td className="py-3 pr-4 text-xs text-surface-500 max-w-xs truncate">{t.detalhe || '—'}</td>
                    <td className="py-3 text-right text-xs text-surface-500">
                      {t.criado_em ? new Date(t.criado_em).toLocaleString('pt-BR') : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    green: 'text-primary-400 bg-primary-900/30',
    blue: 'text-blue-400 bg-blue-900/30',
    yellow: 'text-yellow-400 bg-yellow-900/30',
    purple: 'text-cyan-400 bg-cyan-900/30',
  }
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 rounded-xl ${colors[color]}`}>
        <Icon className="text-2xl" />
      </div>
      <div>
        <p className="text-sm text-surface-400">{label}</p>
        <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
      </div>
    </div>
  )
}

export default function Admin() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('usuarios')
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState(null) // email being acted on

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
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data?.items ?? []))
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

  async function gerenciarPlano(email, tipo) {
    setActionLoading(email + tipo)
    try {
      const res = await api.post('/admin/ativar-plano', { email, tipo })
      const labels = { vitalicio: 'Plano vitalício ativado ✓', trial: 'Trial 7 dias ativado ✓', bloquear: 'Acesso bloqueado' }
      toast.success(labels[tipo] || 'Feito')
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao executar ação')
    } finally {
      setActionLoading(null)
    }
  }

  async function impersonate(u) {
    try {
      const res = await api.post(`/admin/impersonate/${u.id}`)
      const { access_token, user_email, user } = res.data
      // Salva credenciais do admin
      sessionStorage.setItem('admin_token', localStorage.getItem('access_token'))
      sessionStorage.setItem('admin_user', localStorage.getItem('user'))
      sessionStorage.setItem('impersonate_email', user_email)
      // Substitui pelo token do usuário alvo
      localStorage.setItem('access_token', access_token)
      localStorage.setItem('user', JSON.stringify(user))
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao acessar conta')
    }
  }

  const filteredUsers = users.filter(u =>
    !search.trim() ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.name.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Painel Admin</h1>
          <p className="text-sm text-surface-400 mt-1">Visão geral de todos os usuários e métricas</p>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 bg-surface-900/50 p-1 rounded-xl border border-surface-700/50 w-max">
          {[
            { key: 'usuarios', label: 'Usuários', icon: MdPeople },
            { key: 'seguranca', label: 'Segurança', icon: MdSecurity },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === key
                  ? 'bg-primary-600 text-white'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              <Icon className="text-base" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'seguranca' && <SecurityTab />}

      {tab === 'usuarios' && <>
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
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <h2 className="text-sm font-semibold text-surface-300 flex-1">Gerenciar Usuários</h2>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou email..."
            className="bg-surface-900/50 border border-surface-700 text-surface-100 rounded-lg px-3 py-2 text-sm w-full sm:w-64 focus:ring-1 focus:ring-primary-500 outline-none"
          />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-surface-400 border-b border-surface-700/50">
              <th className="font-medium pb-3 pr-4">Nome & Email</th>
              <th className="font-medium pb-3 pr-4">Plano</th>
              <th className="font-medium pb-3 pr-4">Status</th>
              <th className="font-medium pb-3 pr-4">Expira em</th>
              <th className="font-medium pb-3 text-right">Ações rápidas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800/50">
            {filteredUsers.map(u => (
              <tr key={u.id} className="hover:bg-surface-800/30 transition-colors">
                <td className="py-4 pr-4">
                  <p className="text-surface-100 font-medium">
                    {u.name}
                    {u.is_admin && <span className="ml-2 badge-primary">admin</span>}
                  </p>
                  <p className="text-surface-400 text-xs mt-0.5 font-mono">{u.email}</p>
                </td>
                <td className="py-4 pr-4">
                  <span className="text-surface-200 capitalize">{u.plan}</span>
                </td>
                <td className="py-4 pr-4">
                  <span className={`w-max ${u.is_active ? 'badge-green' : 'badge-red'}`}>
                    {u.is_active ? 'Ativo' : 'Bloqueado'}
                  </span>
                </td>
                <td className="py-4 pr-4 text-xs font-mono text-surface-400">
                  {u.plan_expires_at
                    ? new Date(u.plan_expires_at).getFullYear() >= 2099
                      ? '♾ Vitalício'
                      : new Date(u.plan_expires_at).toLocaleDateString('pt-BR')
                    : '—'}
                </td>
                <td className="py-4 text-right">
                  <div className="flex items-center justify-end gap-1.5 flex-wrap">
                    <button
                      onClick={() => impersonate(u)}
                      className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all bg-cyan-900/20 text-cyan-300 hover:bg-cyan-600 hover:text-white border border-cyan-500/20"
                      title="Acessar dashboard como este usuário"
                    >
                      👁️ Acessar
                    </button>
                    <button
                      disabled={actionLoading === u.email + 'vitalicio'}
                      onClick={() => gerenciarPlano(u.email, 'vitalicio')}
                      className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all bg-green-900/20 text-green-400 hover:bg-green-600 hover:text-white border border-green-500/20 disabled:opacity-40"
                      title="Ativar plano vitalício (expira em 2099)"
                    >
                      {actionLoading === u.email + 'vitalicio' ? '...' : '♾ Vitalício'}
                    </button>
                    <button
                      disabled={actionLoading === u.email + 'trial'}
                      onClick={() => gerenciarPlano(u.email, 'trial')}
                      className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all bg-blue-900/20 text-blue-400 hover:bg-blue-600 hover:text-white border border-blue-500/20 disabled:opacity-40"
                      title="Ativar trial de 7 dias"
                    >
                      {actionLoading === u.email + 'trial' ? '...' : '7d Trial'}
                    </button>
                    <button
                      disabled={actionLoading === u.email + 'bloquear'}
                      onClick={() => gerenciarPlano(u.email, 'bloquear')}
                      className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all bg-red-900/20 text-red-400 hover:bg-red-600 hover:text-white border border-red-500/20 disabled:opacity-40"
                      title="Bloquear acesso"
                    >
                      {actionLoading === u.email + 'bloquear' ? '...' : '🚫 Bloquear'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredUsers.length === 0 && (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-surface-800/50 flex items-center justify-center mb-4">
              <MdPeople className="text-3xl text-surface-500" />
            </div>
            <p className="text-surface-400 text-sm font-medium">
              {search ? `Nenhum usuário encontrado para "${search}"` : 'Nenhum usuário encontrado.'}
            </p>
          </div>
        )}
      </div>
      </>}
    </div>
  )
}
