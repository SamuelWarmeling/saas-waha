import { useEffect, useState } from 'react'
import { MdCheckCircle, MdStar, MdAutoAwesome, MdVpnKey, MdVisibility, MdVisibilityOff, MdSpeed } from 'react-icons/md'
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

  // Dispatch slots state
  const [dispatchCfg, setDispatchCfg] = useState({ chips_disparo_simultaneo: 3 })
  const [loadingDispatch, setLoadingDispatch] = useState(false)

  // IA state
  const [iaConfig, setIaConfig] = useState({ gemini_habilitado: true, tem_chave: false, chave_propria: false, chave_parcial: null, tem_chave_servidor: false })
  const [geminiKey, setGeminiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loadingIa, setLoadingIa] = useState(false)
  const [testingIa, setTestingIa] = useState(false)

  useEffect(() => {
    api.get('/usuarios/me').then(r => {
      setUser(r.data)
      setProfile({ name: r.data.name, email: r.data.email })
    })
    api.get('/ia/config').then(r => setIaConfig(r.data)).catch(() => {})
    api.get('/usuarios/me/configuracoes').then(r => {
      if (r.data.chips_disparo_simultaneo != null) {
        setDispatchCfg({ chips_disparo_simultaneo: r.data.chips_disparo_simultaneo })
      }
    }).catch(() => {})
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

  async function saveIaConfig(e) {
    e.preventDefault()
    setLoadingIa(true)
    try {
      await api.put('/ia/config', {
        gemini_api_key: geminiKey || undefined,
        gemini_habilitado: iaConfig.gemini_habilitado,
      })
      const { data } = await api.get('/ia/config')
      setIaConfig(data)
      setGeminiKey('')
      toast.success('Configuração de IA salva!')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar')
    } finally {
      setLoadingIa(false)
    }
  }

  async function testarIa() {
    setTestingIa(true)
    try {
      const { data } = await api.get('/ia/testar')
      if (data.ok) {
        toast.success(`Gemini conectado! Resposta: "${data.resposta}" (${data.modelo})`)
      } else {
        toast.error(data.erro || 'Falha na conexão')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao testar conexão')
    } finally {
      setTestingIa(false)
    }
  }

  async function saveDispatchCfg(e) {
    e.preventDefault()
    setLoadingDispatch(true)
    try {
      const curr = await api.get('/usuarios/me/configuracoes')
      await api.put('/usuarios/me/configuracoes', {
        delay_min: curr.data.delay_min,
        delay_max: curr.data.delay_max,
        limite_diario: curr.data.limite_diario,
        chips_disparo_simultaneo: dispatchCfg.chips_disparo_simultaneo,
      })
      toast.success('Limite de slots atualizado!')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar')
    } finally {
      setLoadingDispatch(false)
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

      {/* Inteligência Artificial */}
      <div className="glass-card border-t border-surface-800/50">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-purple-500/15 text-purple-400 shadow-[0_0_12px_theme(colors.purple.500/15)]">
            <MdAutoAwesome className="text-2xl" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-surface-100">Inteligência Artificial 🤖</h2>
            <p className="text-sm text-surface-400 mt-0.5">Google Gemini para gerar mensagens naturais no aquecimento</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-surface-400 font-medium">IA Global</span>
            <button
              onClick={() => setIaConfig(c => ({ ...c, gemini_habilitado: !c.gemini_habilitado }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${iaConfig.gemini_habilitado ? 'bg-purple-500' : 'bg-surface-700'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${iaConfig.gemini_habilitado ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>

        {/* Status da chave */}
        <div className="flex flex-wrap gap-3 mb-6">
          {iaConfig.tem_chave_servidor && (
            <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: 'rgba(157,78,221,0.12)', color: '#b07de6', border: '1px solid rgba(157,78,221,0.25)' }}>
              <MdVpnKey className="text-sm" /> Chave do servidor ativa
            </span>
          )}
          {iaConfig.chave_propria && (
            <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }}>
              <MdVpnKey className="text-sm" /> Sua chave: {iaConfig.chave_parcial}
            </span>
          )}
          {!iaConfig.tem_chave && (
            <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
              Nenhuma chave configurada — usando pool de mensagens
            </span>
          )}
        </div>

        <form onSubmit={saveIaConfig} className="space-y-5">
          <div>
            <label className="label flex items-center justify-between">
              <span>Chave API do Gemini</span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-purple-400 hover:text-purple-300 font-medium underline underline-offset-2"
              >
                Obter chave gratuita em aistudio.google.com →
              </a>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={geminiKey}
                onChange={e => setGeminiKey(e.target.value)}
                className="input pr-10 placeholder-surface-600"
                placeholder={iaConfig.chave_propria ? `Chave atual: ${iaConfig.chave_parcial} (deixe vazio para manter)` : 'AIza...'}
              />
              <button
                type="button"
                onClick={() => setShowKey(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-200"
              >
                {showKey ? <MdVisibilityOff /> : <MdVisibility />}
              </button>
            </div>
            <p className="text-[11px] text-surface-500 mt-1.5 ml-1">
              Gemini 1.5 Flash é <span className="text-purple-400 font-medium">gratuito até 15 req/min</span>. Sem cartão de crédito.
            </p>
          </div>

          <div className="bg-surface-900/40 border border-surface-800/60 rounded-xl p-4 text-sm text-surface-300 space-y-1.5">
            <p className="font-medium text-surface-200">Como funciona:</p>
            <p>• Com IA ativa, cada mensagem de aquecimento é gerada pelo Gemini — única e natural</p>
            <p>• Sem API key ou com IA desativada, usa o pool de 60+ mensagens pré-definidas</p>
            <p>• Você pode ativar/desativar por chip individualmente na tela de Aquecimento</p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button type="submit" disabled={loadingIa} className="btn-primary px-6" style={{ background: 'linear-gradient(135deg, #7c3aed, #9333ea)', borderColor: 'rgba(157,78,221,0.5)' }}>
              {loadingIa ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Salvando...
                </span>
              ) : 'Salvar Configuração'}
            </button>
            <button
              type="button"
              onClick={testarIa}
              disabled={testingIa || !iaConfig.tem_chave}
              className="btn-secondary px-6 flex items-center gap-2"
            >
              {testingIa ? (
                <>
                  <div className="w-4 h-4 border-2 border-surface-400 border-t-white rounded-full animate-spin" />
                  Testando...
                </>
              ) : (
                <>
                  <MdAutoAwesome className="text-purple-400" />
                  Testar Conexão
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Limites recomendados */}
      <div className="glass-card border-t border-surface-800/50">
        <div className="mb-5">
          <h2 className="text-lg font-bold text-surface-100">Limites de Disparo por Tipo de Chip</h2>
          <p className="text-sm text-surface-400 mt-1">Recomendações de segurança para evitar banimentos</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-yellow-500/25 p-5" style={{ background: 'rgba(234,179,8,0.06)' }}>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">🔥</span>
              <div>
                <p className="font-bold text-yellow-300">Chip Aquecido</p>
                <p className="text-xs text-surface-400 mt-0.5">Passou pelo processo de aquecimento</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-surface-400">Limite recomendado</span>
                <span className="font-bold text-yellow-300">100 msgs/dia</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Delay mínimo</span>
                <span className="font-bold text-surface-200">5s entre msgs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Risco de ban</span>
                <span className="font-bold text-green-400">Baixo</span>
              </div>
            </div>
            <p className="text-xs text-surface-500 mt-4 border-t border-yellow-500/15 pt-3">
              Ajuste o limite do chip individualmente na página <strong className="text-surface-300">Sessões</strong>.
            </p>
          </div>
          <div className="rounded-xl border border-red-500/20 p-5" style={{ background: 'rgba(239,68,68,0.04)' }}>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-bold text-red-300">Chip Não Aquecido</p>
                <p className="text-xs text-surface-400 mt-0.5">Número novo ou sem histórico de conversas</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-surface-400">Limite recomendado</span>
                <span className="font-bold text-red-300">30 msgs/dia</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Delay mínimo</span>
                <span className="font-bold text-surface-200">15s entre msgs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Risco de ban</span>
                <span className="font-bold text-red-400">Alto</span>
              </div>
            </div>
            <p className="text-xs text-surface-500 mt-4 border-t border-red-500/15 pt-3">
              Use a página <strong className="text-surface-300">Aquecimento</strong> para preparar o chip antes de disparar.
            </p>
          </div>
        </div>
      </div>

      {/* Limites de Disparo Simultâneo */}
      <div className="glass-card border-t border-surface-800/50">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-primary-500/15 text-primary-400 shadow-[0_0_12px_theme(colors.primary.500/15)]">
            <MdSpeed className="text-2xl" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-surface-100">Limites de Disparo</h2>
            <p className="text-sm text-surface-400 mt-0.5">Controle quantas campanhas podem disparar ao mesmo tempo</p>
          </div>
        </div>

        <form onSubmit={saveDispatchCfg} className="space-y-5">
          <div>
            <label className="label">Chips disparando simultaneamente</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={1}
                max={10}
                value={dispatchCfg.chips_disparo_simultaneo}
                onChange={e => setDispatchCfg(c => ({ ...c, chips_disparo_simultaneo: Number(e.target.value) }))}
                className="flex-1 accent-primary-500"
              />
              <span className="w-10 text-center text-xl font-black text-primary-300">
                {dispatchCfg.chips_disparo_simultaneo}
              </span>
            </div>
            <p className="text-[11px] text-surface-500 mt-1.5 ml-1">
              Máximo de campanhas que podem estar <strong className="text-surface-400">em execução ao mesmo tempo</strong>. Campanhas extras são colocadas em fila e iniciadas automaticamente.
            </p>
          </div>

          <div className="bg-surface-900/40 border border-surface-800/60 rounded-xl p-4 text-sm text-surface-300 space-y-1.5">
            <p className="font-medium text-surface-200">Como funciona:</p>
            <p>• Aquecimento: <span className="text-green-400 font-medium">sem limite</span> — você pode aquecer quantos chips quiser ao mesmo tempo</p>
            <p>• Disparo: limitado por este valor — quando o limite é atingido, novas campanhas entram na fila</p>
            <p>• Quando uma campanha termina, a próxima da fila inicia automaticamente</p>
          </div>

          <div className="pt-2">
            <button type="submit" disabled={loadingDispatch} className="btn-primary px-6">
              {loadingDispatch ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Salvando...
                </span>
              ) : 'Salvar Limite'}
            </button>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 border-t border-surface-800/50">
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
