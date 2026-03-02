import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdWhatsapp } from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })

  const update = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'register') {
        const { data } = await api.post('/usuarios/registro', form)
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
        localStorage.setItem('user', JSON.stringify(data.user))
        toast.success('Conta criada! Trial de 7 dias ativo.')
        navigate('/dashboard')
      } else {
        const params = new URLSearchParams()
        params.append('username', form.email)
        params.append('password', form.password)
        const { data } = await api.post('/usuarios/login', params, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
        localStorage.setItem('user', JSON.stringify(data.user))
        toast.success('Bem-vindo de volta!')
        navigate('/dashboard')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao autenticar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-primary-500/30 selection:text-primary-100">
      {/* Animated Background blobs */}
      <div className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] rounded-full bg-primary-900/20 blur-[120px] pointer-events-none animate-[pulse_8s_ease-in-out_infinite]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-primary-800/20 blur-[100px] pointer-events-none animate-[pulse_10s_ease-in-out_infinite_reverse]" />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-primary-400 to-primary-600 rounded-3xl mb-5 shadow-2xl shadow-primary-900/50 border border-primary-400/30 backdrop-blur-sm">
            <MdWhatsapp className="text-5xl text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-surface-300 tracking-tight">WahaSaaS</h1>
          <p className="text-primary-400 font-medium text-sm mt-2 tracking-wide">Disparo de mensagens premium</p>
        </div>

        <div className="bg-surface-900/40 backdrop-blur-2xl border border-surface-600/50 rounded-2xl p-6 md:p-8 shadow-2xl shadow-black/50">
          {/* Tabs */}
          <div className="flex bg-surface-950/50 rounded-xl p-1 mb-8 border border-surface-700/50 backdrop-blur-sm">
            {['login', 'register'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-300 ${mode === m
                    ? 'bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-lg shadow-primary-900/40 border border-primary-400/40'
                    : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'
                  }`}
              >
                {m === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1.5 ml-1">Nome</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={update}
                  placeholder="Seu nome completo"
                  required
                  className="w-full bg-surface-950/60 border border-surface-700 rounded-xl px-4 py-3 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 transition-all backdrop-blur-md shadow-inner"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1.5 ml-1">E-mail</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={update}
                placeholder="seu@email.com"
                required
                className="w-full bg-surface-950/60 border border-surface-700 rounded-xl px-4 py-3 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 transition-all backdrop-blur-md shadow-inner"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1.5 ml-1">Senha</label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={update}
                placeholder="Mínimo 8 caracteres"
                required
                minLength={8}
                className="w-full bg-surface-950/60 border border-surface-700 rounded-xl px-4 py-3 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 transition-all backdrop-blur-md shadow-inner"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-6 bg-primary-600 hover:bg-primary-500 hover:-translate-y-0.5 text-white font-semibold py-3.5 rounded-xl transition-all shadow-[0_0_20px_theme(colors.primary.900/60)] hover:shadow-[0_0_25px_theme(colors.primary.600/50)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 border border-primary-500/30"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Processando...
                </span>
              ) : mode === 'login' ? 'Acessar Plataforma' : 'Criar Conta Grátis'}
            </button>
          </form>

          {mode === 'register' && (
            <div className="mt-6 pt-5 border-t border-surface-700/50 text-center">
              <p className="text-sm font-medium text-surface-400 group flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary-500 shadow-[0_0_8px_theme(colors.primary.500)]"></span>
                7 dias de trial grátis liberados.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
