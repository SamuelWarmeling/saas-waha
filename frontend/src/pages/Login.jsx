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
        const { data } = await api.post('/auth/cadastro', {
          name: form.name,
          email: form.email,
          password: form.password,
        })
        if (data.access_token) localStorage.setItem('access_token', data.access_token)
        if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token)
        if (data.user) localStorage.setItem('user', JSON.stringify(data.user))
        toast.success('Conta criada! Trial de 7 dias ativo.')
        window.location.href = data.checkout_url || data.redirect || '/dashboard'
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
      const rawDetail = err.response?.data?.detail
      const msg = Array.isArray(rawDetail)
        ? rawDetail.map(d => d.msg || JSON.stringify(d)).join(' | ')
        : (typeof rawDetail === 'string' ? rawDetail : null) || err.message || 'Erro ao autenticar'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden font-sans"
      style={{ background: '#0B0914', selection: 'rgba(157,78,221,0.3)' }}
    >
      {/* Animated background blobs */}
      <div
        className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] rounded-full pointer-events-none animate-[pulse_8s_ease-in-out_infinite]"
        style={{ background: 'rgba(157,78,221,0.08)', filter: 'blur(120px)' }}
      />
      <div
        className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] rounded-full pointer-events-none animate-[pulse_10s_ease-in-out_infinite_reverse]"
        style={{ background: 'rgba(106,13,173,0.12)', filter: 'blur(100px)' }}
      />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40vw] h-[40vw] rounded-full pointer-events-none"
        style={{ background: 'rgba(157,78,221,0.04)', filter: 'blur(80px)' }}
      />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5 shadow-2xl border border-primary-400/20"
            style={{
              background: 'linear-gradient(135deg, #9D4EDD, #6A0DAD)',
              boxShadow: '0 0 40px rgba(157,78,221,0.35)',
            }}
          >
            <MdWhatsapp className="text-5xl text-white" />
          </div>
          <h1
            className="text-3xl font-extrabold tracking-tight"
            style={{
              background: 'linear-gradient(90deg, #ffffff, #b07de6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            WahaSaaS
          </h1>
          <p className="text-primary-400 font-medium text-sm mt-2 tracking-wide">
            Disparo de mensagens premium
          </p>
        </div>

        {/* Card glassmorphism */}
        <div
          className="rounded-2xl p-6 md:p-8 shadow-2xl"
          style={{
            background: 'rgba(255,255,255,0.05)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(157,78,221,0.2)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(157,78,221,0.05)',
          }}
        >
          {/* Tabs */}
          <div
            className="flex rounded-xl p-1 mb-8"
            style={{ background: 'rgba(11,9,20,0.6)', border: '1px solid rgba(157,78,221,0.15)' }}
          >
            {['login', 'register'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-300"
                style={
                  mode === m
                    ? {
                        background: 'linear-gradient(135deg, #9D4EDD, #6A0DAD)',
                        color: 'white',
                        boxShadow: '0 0 20px rgba(157,78,221,0.3)',
                        border: '1px solid rgba(157,78,221,0.4)',
                      }
                    : { color: '#64748b', background: 'transparent' }
                }
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
                  className="input"
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
                className="input"
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
                className="input"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-6 text-white font-semibold py-3.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #9D4EDD, #6A0DAD)',
                border: '1px solid rgba(157,78,221,0.4)',
                boxShadow: '0 0 20px rgba(157,78,221,0.3)',
              }}
              onMouseEnter={e => {
                if (!loading) e.currentTarget.style.boxShadow = '0 0 30px rgba(157,78,221,0.5)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = '0 0 20px rgba(157,78,221,0.3)'
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processando...
                </span>
              ) : mode === 'login' ? 'Acessar Plataforma' : 'Criar Conta Grátis'}
            </button>
          </form>

          {mode === 'register' && (
            <div
              className="mt-6 pt-5 text-center"
              style={{ borderTop: '1px solid rgba(157,78,221,0.15)' }}
            >
              <p className="text-sm font-medium text-surface-400 flex items-center justify-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: '#9D4EDD', boxShadow: '0 0 8px #9D4EDD' }}
                />
                7 dias de trial grátis liberados.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
