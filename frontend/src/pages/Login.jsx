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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-600 rounded-2xl mb-4">
            <MdWhatsapp className="text-4xl text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">WahaSaaS</h1>
          <p className="text-gray-500 text-sm mt-1">Disparo de WhatsApp em massa</p>
        </div>

        <div className="card">
          {/* Tabs */}
          <div className="flex bg-gray-800 rounded-lg p-1 mb-6">
            {['login', 'register'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  mode === m ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {m === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="label">Nome</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={update}
                  placeholder="Seu nome"
                  required
                  className="input"
                />
              </div>
            )}
            <div>
              <label className="label">E-mail</label>
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
              <label className="label">Senha</label>
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
            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta grátis'}
            </button>
          </form>

          {mode === 'register' && (
            <p className="text-xs text-gray-500 text-center mt-4">
              7 dias de trial grátis. Sem cartão necessário.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
