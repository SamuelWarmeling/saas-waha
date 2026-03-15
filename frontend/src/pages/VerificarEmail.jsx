import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api from '../api'

// ── Countdown Timer ────────────────────────────────────────────────────────────

function useCountdown(initialSeconds = 0) {
  const [remaining, setRemaining] = useState(initialSeconds)
  useEffect(() => {
    if (remaining <= 0) return
    const t = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [remaining])
  // reset(n) allows restarting with a different value
  const reset = (n) => setRemaining(n ?? initialSeconds)
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  return { remaining, label: `${mm}:${ss}`, reset }
}

// ── OTP Input ─────────────────────────────────────────────────────────────────

function OTPInput({ value, onChange }) {
  const inputsRef = useRef([])
  const digits = value.split('')

  const handleKey = (e, idx) => {
    const { key } = e

    if (key === 'Backspace') {
      e.preventDefault()
      if (digits[idx]) {
        const next = [...digits]
        next[idx] = ''
        onChange(next.join(''))
      } else if (idx > 0) {
        inputsRef.current[idx - 1]?.focus()
      }
      return
    }

    if (key === 'ArrowLeft' && idx > 0) {
      inputsRef.current[idx - 1]?.focus()
      return
    }
    if (key === 'ArrowRight' && idx < 5) {
      inputsRef.current[idx + 1]?.focus()
      return
    }
  }

  const handleInput = (e, idx) => {
    const char = e.target.value.replace(/\D/g, '')
    if (!char) return
    const next = [...digits]
    next[idx] = char[char.length - 1]
    onChange(next.join(''))
    if (idx < 5) inputsRef.current[idx + 1]?.focus()
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted) {
      onChange(pasted.padEnd(6, '').slice(0, 6))
      const focusIdx = Math.min(pasted.length, 5)
      inputsRef.current[focusIdx]?.focus()
    }
  }

  return (
    <div className="flex gap-3 justify-center" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, idx) => (
        <input
          key={idx}
          ref={(el) => (inputsRef.current[idx] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[idx] || ''}
          onKeyDown={(e) => handleKey(e, idx)}
          onInput={(e) => handleInput(e, idx)}
          onChange={() => {}}
          onClick={() => inputsRef.current[idx]?.select()}
          className="w-12 h-14 text-center text-2xl font-bold bg-gray-900 border-2 border-gray-700 text-white rounded-xl focus:outline-none focus:border-cyan-500 transition-colors caret-transparent"
        />
      ))}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function VerificarEmail() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const email = searchParams.get('email') || ''

  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingReenvio, setLoadingReenvio] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const { remaining, label, reset } = useCountdown(30 * 60) // 30 min expiration
  const reenvio = useCountdown(0) // reenvio cooldown — starts at 0 (enabled)

  if (!email) {
    navigate('/checkout')
    return null
  }

  const handleVerify = async () => {
    if (code.length !== 6) return setError('Digite os 6 dígitos do código.')
    setError('')
    setLoading(true)

    try {
      const res = await api.post('/api/auth/verificar-email', { email, codigo: code })
      const { access_token, refresh_token, user } = res.data

      // Salva tokens
      localStorage.setItem('access_token', access_token)
      localStorage.setItem('refresh_token', refresh_token)
      localStorage.setItem('user', JSON.stringify(user))

      setSuccess('E-mail verificado! Redirecionando para o pagamento...')

      // Redireciona para pagamento
      try {
        const prefRes = await api.post('/api/pagamentos/criar-preferencia', { plano: 'pro' })
        window.location.href = prefRes.data.init_point
      } catch {
        // Se falhar pagamento, vai para dashboard
        navigate('/dashboard')
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Código inválido. Tente novamente.')
      setLoading(false)
    }
  }

  const handleReenviar = async () => {
    setError('')
    setLoadingReenvio(true)

    try {
      await api.post('/api/auth/reenviar-codigo', { email })
      setSuccess('Novo código enviado para ' + email)
      reenvio.reset(60) // inicia cooldown de 60s
      reset(30 * 60)    // reseta timer de expiração do código
      setCode('')
      setTimeout(() => setSuccess(''), 4000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Erro ao reenviar código.')
    } finally {
      setLoadingReenvio(false)
    }
  }

  const expired = remaining === 0

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
        <div className="w-9 h-9 bg-gradient-to-br from-cyan-600 to-violet-500 rounded-lg flex items-center justify-center font-bold text-sm">W</div>
        <span className="font-bold text-xl">WahaSaaS</span>
      </div>

      <div className="w-full max-w-md bg-gray-800 border border-gray-700 rounded-2xl p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">📧</div>
          <h1 className="text-2xl font-bold text-white mb-2">Verifique seu e-mail</h1>
          <p className="text-gray-400 text-sm">
            Enviamos um código de 6 dígitos para
          </p>
          <p className="text-cyan-300 font-medium text-sm mt-1">{email}</p>
        </div>

        {/* Timer */}
        {!expired ? (
          <div className="flex items-center justify-center gap-2 mb-6 text-sm">
            <span className="text-gray-500">Código expira em</span>
            <span className={`font-mono font-bold px-2 py-0.5 rounded ${remaining < 120 ? 'text-red-400 bg-red-900/20' : 'text-cyan-300 bg-cyan-900/20'}`}>
              {label}
            </span>
          </div>
        ) : (
          <div className="bg-red-900/20 border border-red-700/40 text-red-300 text-sm rounded-lg px-4 py-3 text-center mb-6">
            Código expirado. Solicite um novo abaixo.
          </div>
        )}

        {/* OTP Inputs */}
        <div className="mb-6">
          <OTPInput value={code} onChange={setCode} />
        </div>

        {/* Feedback */}
        {error && (
          <div className="bg-red-900/20 border border-red-700/40 text-red-300 text-sm rounded-lg px-4 py-3 mb-4 text-center">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-900/20 border border-green-700/40 text-green-300 text-sm rounded-lg px-4 py-3 mb-4 text-center">
            {success}
          </div>
        )}

        {/* Verify button */}
        <button
          onClick={handleVerify}
          disabled={loading || code.length !== 6 || expired}
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-base transition-all mb-4"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Verificando...
            </span>
          ) : (
            'Confirmar código →'
          )}
        </button>

        {/* Reenviar */}
        <div className="text-center">
          <p className="text-gray-500 text-sm mb-2">Não recebeu o código?</p>
          <button
            onClick={handleReenviar}
            disabled={loadingReenvio || reenvio.remaining > 0}
            className="text-cyan-400 hover:text-cyan-300 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loadingReenvio
              ? 'Reenviando...'
              : reenvio.remaining > 0
              ? `Reenviar em ${reenvio.label}`
              : 'Reenviar código'}
          </button>
        </div>

        {/* Voltar */}
        <div className="mt-6 pt-5 border-t border-gray-700 text-center">
          <button
            onClick={() => navigate('/checkout')}
            className="text-gray-500 hover:text-gray-400 text-sm transition-colors"
          >
            ← Voltar e corrigir e-mail
          </button>
        </div>
      </div>

      <p className="text-gray-700 text-xs mt-6">
        Verifique também a pasta de spam.
      </p>
    </div>
  )
}
