import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

// ── Urgency Timer ─────────────────────────────────────────────────────────────

function UrgencyTimer() {
  const [time, setTime] = useState(15 * 60) // 15 min

  useEffect(() => {
    const t = setInterval(() => setTime((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [])

  const mm = String(Math.floor(time / 60)).padStart(2, '0')
  const ss = String(time % 60).padStart(2, '0')

  return (
    <div className="bg-gradient-to-r from-red-600 to-red-500 text-white text-center py-2 px-4 text-sm font-semibold">
      🔥 Oferta especial! R$97/mês (era R$197) — expira em{' '}
      <span className="font-mono bg-red-700 px-1.5 py-0.5 rounded text-white">
        {mm}:{ss}
      </span>
    </div>
  )
}

// ── Plan Summary (left column) ─────────────────────────────────────────────────

function PlanSummary() {
  const planFeatures = [
    '5 sessões WhatsApp',
    '500 disparos por dia',
    'IA Anti-Ban ativa',
    'Agendamento de campanhas',
    'Importação Excel/CSV',
    'Dashboard com métricas',
    'Suporte via WhatsApp',
    'Atualizações incluídas',
  ]

  return (
    <div className="space-y-6">
      {/* Plan card */}
      <div className="bg-gray-800 border border-purple-600/50 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-white text-lg">Plano Pro</h3>
            <p className="text-gray-400 text-sm">Acesso completo</p>
          </div>
          <div className="text-right">
            <p className="text-gray-500 line-through text-sm">R$197/mês</p>
            <p className="text-white font-bold text-2xl">R$97<span className="text-sm font-normal text-gray-400">/mês</span></p>
          </div>
        </div>

        <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-full px-3 py-1 text-xs font-semibold mb-5">
          ✓ 7 dias grátis incluídos
        </div>

        <ul className="space-y-2.5">
          {planFeatures.map((f) => (
            <li key={f} className="flex items-center gap-2.5 text-sm text-gray-300">
              <span className="text-green-400 font-bold flex-shrink-0">✓</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Security badges */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: '🔒', label: 'Pagamento seguro' },
          { icon: '✅', label: '7 dias grátis' },
          { icon: '🛡️', label: 'Cancele quando quiser' },
        ].map((b) => (
          <div key={b.label} className="bg-gray-800 border border-gray-700 rounded-xl p-3 text-center">
            <div className="text-xl mb-1">{b.icon}</div>
            <p className="text-xs text-gray-400 leading-tight">{b.label}</p>
          </div>
        ))}
      </div>

      {/* Testimonial */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
        <div className="flex items-center gap-1 text-yellow-400 text-sm mb-3">★★★★★</div>
        <p className="text-gray-300 text-sm leading-relaxed mb-4 italic">
          "Em 30 dias usando o WahaSaaS, minha taxa de conversão subiu 340%. O sistema é simples e funciona de verdade."
        </p>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-purple-700 rounded-full flex items-center justify-center text-xs font-bold">MS</div>
          <div>
            <p className="text-white text-sm font-semibold">Marcos Silva</p>
            <p className="text-gray-500 text-xs">Consultor de marketing digital</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Registration Form (right column) ──────────────────────────────────────────

function RegistrationForm() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' })
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
    if (error) setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!form.name.trim()) return setError('Informe seu nome completo.')
    if (!form.email.trim()) return setError('Informe seu e-mail.')
    if (form.password.length < 8) return setError('A senha deve ter no mínimo 8 caracteres.')
    if (form.password !== form.confirmPassword) return setError('As senhas não coincidem.')

    setLoading(true)
    try {
      // 1. Register user
      await api.post('/api/usuarios/registro', {
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim(),
      })

      // 2. Login to get token
      const loginData = new URLSearchParams()
      loginData.append('username', form.email.trim())
      loginData.append('password', form.password)
      const loginRes = await api.post('/api/usuarios/login', loginData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      const { access_token, refresh_token } = loginRes.data
      localStorage.setItem('access_token', access_token)
      localStorage.setItem('refresh_token', refresh_token)

      // 3. Create payment preference
      const prefRes = await api.post('/api/pagamentos/criar-preferencia', { plano: 'pro' })
      const { init_point } = prefRes.data

      // 4. Redirect to Mercado Pago
      window.location.href = init_point
    } catch (err) {
      const msg = err.response?.data?.detail
      if (msg === 'Email já cadastrado') {
        setError('Este e-mail já está cadastrado. Tente fazer login.')
      } else {
        setError(msg || 'Erro ao criar conta. Tente novamente.')
      }
      setLoading(false)
    }
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-2xl p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">Criar sua conta</h2>
        <p className="text-gray-400 text-sm">7 dias grátis, depois R$97/mês</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-300 text-sm rounded-lg px-4 py-3 mb-5">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome completo</label>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Seu nome"
            required
            className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-purple-500 transition-colors placeholder-gray-600"
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">E-mail</label>
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            placeholder="seu@email.com"
            required
            className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-purple-500 transition-colors placeholder-gray-600"
          />
        </div>

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Senha</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Mínimo 8 caracteres"
              required
              className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-4 py-3 pr-11 text-sm focus:outline-none focus:border-purple-500 transition-colors placeholder-gray-600"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              tabIndex={-1}
            >
              {showPass ? '🙈' : '👁️'}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirmar senha</label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              name="confirmPassword"
              value={form.confirmPassword}
              onChange={handleChange}
              placeholder="Repita a senha"
              required
              className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-4 py-3 pr-11 text-sm focus:outline-none focus:border-purple-500 transition-colors placeholder-gray-600"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              tabIndex={-1}
            >
              {showConfirm ? '🙈' : '👁️'}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-base transition-all mt-2"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              Processando...
            </span>
          ) : (
            'Criar conta e pagar →'
          )}
        </button>

        <p className="text-xs text-gray-500 text-center leading-relaxed">
          Ao continuar, você concorda com nossos{' '}
          <a href="#" className="text-purple-400 hover:underline">Termos de uso</a>{' '}
          e{' '}
          <a href="#" className="text-purple-400 hover:underline">Política de privacidade</a>.
        </p>
      </form>

      <div className="mt-6 pt-5 border-t border-gray-700 text-center">
        <p className="text-sm text-gray-500">
          Já tem uma conta?{' '}
          <button
            onClick={() => navigate('/login')}
            className="text-purple-400 hover:text-purple-300 font-medium"
          >
            Fazer login
          </button>
        </p>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Checkout() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <UrgencyTimer />

      {/* Navbar */}
      <nav className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-purple-600 to-violet-500 rounded flex items-center justify-center text-xs font-bold">W</div>
            <span className="font-bold text-base">WahaSaaS</span>
          </button>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>🔒 Compra segura</span>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 py-10 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">
              Comece a disparar hoje mesmo
            </h1>
            <p className="text-gray-400 text-sm">Sem risco · 7 dias grátis · Cancele quando quiser</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 items-start">
            <PlanSummary />
            <RegistrationForm />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-5 px-4 text-center text-xs text-gray-600">
        WahaSaaS © {new Date().getFullYear()} · Todos os direitos reservados
      </footer>
    </div>
  )
}
