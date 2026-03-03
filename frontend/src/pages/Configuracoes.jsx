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
    color: 'border-primary-500',
    btnClass: 'btn-primary',
    highlight: true,
  },
  {
    id: 'business', name: 'Business', price: 797,
    sessions: 10, messages: 1000,
    features: ['10 sessões WhatsApp', '1000 disparos/dia', 'API de integração', 'Suporte dedicado', 'Relatórios em tempo real'],
    color: 'border-primary-600',
    btnClass: 'btn-primary',
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
    <div className="space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Configurações</h1>
        <p className="text-sm text-surface-400 mt-1">Gerencie sua conta, perfil e assinatura</p>
      </div>

      {/* Plano atual */}
      <div className={`glass-card flex items-center gap-5 p-6 border-l-4 ${isPlanActive ? 'border-l-primary-500 bg-primary-900/10' : 'border-l-red-500 bg-red-900/10'}`}>
        <div className={`p-4 rounded-2xl flex items-center justify-center ${isPlanActive ? 'bg-primary-500/20 text-primary-400 shadow-[0_0_15px_theme(colors.primary.500/20)]' : 'bg-red-500/20 text-red-400 shadow-[0_0_15px_theme(colors.red.500/20)]'}`}>
          <MdStar className="text-3xl" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-surface-400 uppercase tracking-wider mb-1">Status da Assinatura</p>
          <div className="flex items-center gap-3">
            <p className="text-2xl font-bold text-surface-50 capitalize">{user?.plan || 'Gratuito'}</p>
            {isPlanActive && <span className="badge-green text-xs px-2 py-0.5">Ativo</span>}
            {!isPlanActive && user?.plan && <span className="badge-red text-xs px-2 py-0.5">Inativo</span>}
          </div>
          <p className={`text-sm mt-1.5 font-medium ${isPlanActive ? 'text-primary-400/90' : 'text-red-400/90'}`}>
            {isPlanActive ? `Sua assinatura é válida até ${expiresDate}` : 'Seu plano está expirado. Escolha uma opção abaixo para renovar.'}
          </p>
        </div>
      </div>

      {/* Planos */}
      <div>
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold text-surface-100">Planos e Preços</h2>
            <p className="text-sm text-surface-400 mt-1">Escolha o plano ideal para o tamanho do seu negócio</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-stretch pt-4">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`glass-card p-0 flex flex-col relative transition-all duration-300 hover:-translate-y-2 ${plan.highlight
                  ? 'border-primary-500/50 shadow-[0_0_30px_theme(colors.primary.900/40)] scale-105 z-10'
                  : 'border-surface-700/50 hover:border-surface-600'
                }`}
            >
              {plan.highlight && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary-600 to-primary-500 text-white text-[10px] uppercase tracking-widest font-bold px-4 py-1.5 rounded-full shadow-lg shadow-primary-500/50 border border-primary-400/30">
                  Mais Popular
                </div>
              )}

              <div className={`p-8 border-b ${plan.highlight ? 'border-primary-500/20 bg-primary-900/10' : 'border-surface-800/50 bg-surface-900/30'}`}>
                <h3 className={`text-xl font-bold ${plan.highlight ? 'text-primary-300' : 'text-surface-200'}`}>{plan.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-sm font-medium text-surface-400">R$</span>
                  <span className="text-4xl font-black text-surface-50 tracking-tight">{plan.price}</span>
                  <span className="text-surface-500 text-sm font-medium">/mês</span>
                </div>
              </div>

              <div className="p-8 flex-1 flex flex-col">
                <ul className="space-y-4 mb-8 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-3 text-sm text-surface-300">
                      <MdCheckCircle className={`text-lg shrink-0 mt-0.5 ${plan.highlight ? 'text-primary-400' : 'text-primary-500/70'}`} />
                      <span className="leading-tight">{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => selectPlan(plan.id)}
                  disabled={user?.plan === plan.id && isPlanActive}
                  className={`w-full py-3 rounded-xl font-bold transition-all ${user?.plan === plan.id && isPlanActive
                      ? 'bg-surface-800 text-surface-500 cursor-not-allowed border border-surface-700'
                      : plan.highlight
                        ? 'bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white shadow-lg shadow-primary-500/25 border border-primary-500/50'
                        : 'bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-600/50'
                    }`}
                >
                  {user?.plan === plan.id && isPlanActive ? 'Plano Atual' : 'Assinar Agora'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-6 border-t border-surface-800/50">
        {/* Perfil */}
        <div className="glass-card">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-surface-100">Dados do Perfil</h2>
            <p className="text-sm text-surface-400 mt-1">Atualize suas informações pessoais</p>
          </div>
          <form onSubmit={saveProfile} className="space-y-5">
            <div>
              <label className="label">Nome Completo</label>
              <input
                value={profile.name}
                onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                className="input placeholder-surface-600"
                placeholder="Seu nome"
                required
              />
            </div>
            <div>
              <label className="label">E-mail</label>
              <input
                type="email"
                value={profile.email}
                onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                className="input placeholder-surface-600"
                placeholder="seu@email.com"
                required
              />
            </div>
            <div className="pt-2">
              <button type="submit" disabled={loadingProfile} className="btn-primary w-full sm:w-auto px-8">
                {loadingProfile ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </span>
                ) : 'Salvar Alterações'}
              </button>
            </div>
          </form>
        </div>

        {/* Senha */}
        <div className="glass-card">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-surface-100">Segurança da Conta</h2>
            <p className="text-sm text-surface-400 mt-1">Altere sua senha de acesso regularmente</p>
          </div>
          <form onSubmit={changePassword} className="space-y-5">
            <div>
              <label className="label">Senha Atual</label>
              <input
                type="password"
                value={passwords.current_password}
                onChange={e => setPasswords(p => ({ ...p, current_password: e.target.value }))}
                className="input placeholder-surface-600"
                placeholder="••••••••"
                required
              />
            </div>
            <div>
              <label className="label">Nova Senha</label>
              <input
                type="password"
                value={passwords.new_password}
                onChange={e => setPasswords(p => ({ ...p, new_password: e.target.value }))}
                className="input placeholder-surface-600"
                placeholder="••••••••"
                required
                minLength={8}
              />
              <p className="text-[11px] text-surface-500 mt-1.5 font-medium ml-1">A nova senha deve ter pelo menos 8 caracteres.</p>
            </div>
            <div className="pt-2">
              <button type="submit" disabled={loadingPassword} className="btn-secondary w-full sm:w-auto px-8">
                {loadingPassword ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-surface-400 border-t-white rounded-full animate-spin" />
                    Alterando...
                  </span>
                ) : 'Atualizar Senha'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
