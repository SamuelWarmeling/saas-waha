import { useEffect, useState } from 'react'
import { MdCheckCircle, MdStar } from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

const PLANS = [
  {
    id: 'starter', name: 'Starter', price: 197,
    sessions: 2, messages: 200,
    features: ['2 sessões WhatsApp', '200 disparos/dia', 'Importação XLSX', 'Suporte por e-mail'],
    color: 'border-gray-700',
    btnClass: 'btn-secondary',
  },
  {
    id: 'pro', name: 'Pro', price: 397,
    sessions: 5, messages: 500,
    features: ['5 sessões WhatsApp', '500 disparos/dia', 'Importação XLSX', 'Suporte prioritário', 'Relatórios avançados'],
    color: 'border-green-600',
    btnClass: 'btn-primary',
    highlight: true,
  },
  {
    id: 'business', name: 'Business', price: 797,
    sessions: 10, messages: 1000,
    features: ['10 sessões WhatsApp', '1000 disparos/dia', 'API de integração', 'Suporte dedicado', 'Relatórios em tempo real'],
    color: 'border-purple-600',
    btnClass: 'bg-purple-600 hover:bg-purple-500 text-white font-medium px-4 py-2 rounded-lg transition-colors',
  },
]

export default function Configuracoes() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState({ name: '', email: '' })
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' })
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [loadingPassword, setLoadingPassword] = useState(false)

  useEffect(() => {
    api.get('/usuarios/me').then(r => {
      setUser(r.data)
      setProfile({ name: r.data.name, email: r.data.email })
    })
  }, [])

  async function saveProfile(e) {
    e.preventDefault()
    setLoadingProfile(true)
    try {
      const { data } = await api.put('/usuarios/me', profile)
      setUser(data)
      toast.success('Perfil atualizado!')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar')
    } finally {
      setLoadingProfile(false)
    }
  }

  async function changePassword(e) {
    e.preventDefault()
    if (passwords.new_password.length < 8) {
      toast.error('Nova senha deve ter no mínimo 8 caracteres')
      return
    }
    setLoadingPassword(true)
    try {
      await api.post('/usuarios/alterar-senha', passwords)
      toast.success('Senha alterada!')
      setPasswords({ current_password: '', new_password: '' })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao alterar senha')
    } finally {
      setLoadingPassword(false)
    }
  }

  async function selectPlan(planId) {
    try {
      const { data } = await api.post('/pagamentos/criar-preferencia', { plan_id: planId })
      window.open(data.sandbox_init_point || data.init_point, '_blank')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao processar pagamento')
    }
  }

  const isPlanActive = user?.plan_expires_at
    ? new Date(user.plan_expires_at) > new Date()
    : false

  const expiresDate = user?.plan_expires_at
    ? new Date(user.plan_expires_at).toLocaleDateString('pt-BR')
    : null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-white">Configurações</h1>
        <p className="text-sm text-gray-500">Gerencie sua conta e assinatura</p>
      </div>

      {/* Plano atual */}
      <div className="card flex items-center gap-4">
        <div className={`p-3 rounded-xl ${isPlanActive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
          <MdStar className="text-2xl" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-500">Plano atual</p>
          <p className="font-bold text-white capitalize">{user?.plan || '–'}</p>
          <p className={`text-xs mt-0.5 ${isPlanActive ? 'text-green-400' : 'text-red-400'}`}>
            {isPlanActive ? `Válido até ${expiresDate}` : 'Plano expirado — renove abaixo'}
          </p>
        </div>
      </div>

      {/* Planos */}
      <div>
        <h2 className="text-base font-semibold text-white mb-4">Escolha seu plano</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`card border-2 relative ${plan.color} ${plan.highlight ? 'shadow-lg shadow-green-900/20' : ''}`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs font-bold px-3 py-0.5 rounded-full">
                  MAIS POPULAR
                </div>
              )}
              <h3 className="text-lg font-bold text-white">{plan.name}</h3>
              <div className="mt-2 mb-4">
                <span className="text-3xl font-black text-white">R${plan.price}</span>
                <span className="text-gray-500 text-sm">/mês</span>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                    <MdCheckCircle className="text-green-500 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => selectPlan(plan.id)}
                disabled={user?.plan === plan.id && isPlanActive}
                className={`w-full ${plan.btnClass} disabled:opacity-50 disabled:cursor-default`}
              >
                {user?.plan === plan.id && isPlanActive ? 'Plano atual' : 'Assinar'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Perfil */}
      <div className="card max-w-xl">
        <h2 className="text-base font-semibold text-white mb-4">Dados do perfil</h2>
        <form onSubmit={saveProfile} className="space-y-4">
          <div>
            <label className="label">Nome</label>
            <input
              value={profile.name}
              onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
              className="input"
              required
            />
          </div>
          <div>
            <label className="label">E-mail</label>
            <input
              type="email"
              value={profile.email}
              onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
              className="input"
              required
            />
          </div>
          <button type="submit" disabled={loadingProfile} className="btn-primary">
            {loadingProfile ? 'Salvando...' : 'Salvar perfil'}
          </button>
        </form>
      </div>

      {/* Senha */}
      <div className="card max-w-xl">
        <h2 className="text-base font-semibold text-white mb-4">Alterar senha</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label className="label">Senha atual</label>
            <input
              type="password"
              value={passwords.current_password}
              onChange={e => setPasswords(p => ({ ...p, current_password: e.target.value }))}
              className="input"
              required
            />
          </div>
          <div>
            <label className="label">Nova senha</label>
            <input
              type="password"
              value={passwords.new_password}
              onChange={e => setPasswords(p => ({ ...p, new_password: e.target.value }))}
              className="input"
              required
              minLength={8}
            />
          </div>
          <button type="submit" disabled={loadingPassword} className="btn-primary">
            {loadingPassword ? 'Alterando...' : 'Alterar senha'}
          </button>
        </form>
      </div>
    </div>
  )
}
