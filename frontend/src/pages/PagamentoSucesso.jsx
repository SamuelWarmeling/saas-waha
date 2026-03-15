import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 30000

export default function PagamentoSucesso() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('aguardando') // aguardando | ativo | timeout | erro
  const [segundos, setSegundos] = useState(Math.ceil(POLL_TIMEOUT_MS / 1000))
  const timerRef = useRef(null)
  const pollRef = useRef(null)
  const startedAt = useRef(Date.now())

  useEffect(() => {
    // Não há token → redireciona para checkout
    const token = localStorage.getItem('access_token')
    if (!token) {
      navigate('/checkout', { replace: true })
      return
    }

    // Countdown de segundos
    timerRef.current = setInterval(() => {
      const decorrido = Date.now() - startedAt.current
      const restam = Math.max(0, Math.ceil((POLL_TIMEOUT_MS - decorrido) / 1000))
      setSegundos(restam)
      if (restam === 0) clearInterval(timerRef.current)
    }, 1000)

    // Polling do status
    const poll = async () => {
      const decorrido = Date.now() - startedAt.current
      if (decorrido >= POLL_TIMEOUT_MS) {
        clearInterval(pollRef.current)
        setStatus('timeout')
        return
      }

      try {
        const res = await api.get('/auth/status')
        if (res.data.ativo) {
          clearInterval(pollRef.current)
          clearInterval(timerRef.current)

          // Atualiza user no localStorage com trial info
          const stored = localStorage.getItem('user')
          if (stored) {
            try {
              const u = JSON.parse(stored)
              u.trial_ativo = res.data.trial_ativo
              u.trial_expira_em = res.data.trial_expira_em
              u.is_active = true
              localStorage.setItem('user', JSON.stringify(u))
            } catch (_) {}
          }

          setStatus('ativo')
          setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
        }
      } catch (err) {
        // 401 = token inválido (não deveria acontecer aqui)
        if (err.response?.status === 401) {
          clearInterval(pollRef.current)
          clearInterval(timerRef.current)
          setStatus('erro')
        }
        // outros erros: continua tentando
      }
    }

    poll() // dispara imediatamente
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      clearInterval(pollRef.current)
      clearInterval(timerRef.current)
    }
  }, [navigate])

  const irParaDashboard = () => navigate('/dashboard', { replace: true })

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-10 flex items-center gap-2">
        <div className="w-9 h-9 bg-gradient-to-br from-cyan-600 to-violet-500 rounded-lg flex items-center justify-center font-bold text-sm">
          W
        </div>
        <span className="font-bold text-xl">WahaSaaS</span>
      </div>

      <div className="w-full max-w-md bg-gray-800 border border-gray-700 rounded-2xl p-8 text-center">

        {/* ── Ativando ────────────────────────────────────────────────── */}
        {status === 'aguardando' && (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-bold text-white mb-2">Trial de 7 dias iniciado!</h1>
            <p className="text-gray-400 text-sm mb-2">
              Você <strong className="text-green-400">não será cobrado agora</strong>.
            </p>
            <p className="text-gray-500 text-xs mb-8">
              Seu cartão será cobrado apenas após o período de avaliação.
            </p>

            <div className="flex items-center justify-center gap-3 mb-6">
              <span className="w-5 h-5 border-2 border-cyan-500/40 border-t-purple-400 rounded-full animate-spin inline-block" />
              <span className="text-gray-400 text-sm">Ativando sua conta...</span>
            </div>

            <div className="bg-gray-900/60 rounded-xl px-4 py-3 text-xs text-gray-500">
              Aguardando confirmação do Stripe ({segundos}s)
            </div>
          </>
        )}

        {/* ── Ativo → redirecionando ───────────────────────────────────── */}
        {status === 'ativo' && (
          <>
            <div className="text-5xl mb-4">✅</div>
            <h1 className="text-2xl font-bold text-white mb-2">Conta ativada!</h1>
            <p className="text-gray-400 text-sm">Redirecionando para o dashboard...</p>
          </>
        )}

        {/* ── Timeout ─────────────────────────────────────────────────── */}
        {status === 'timeout' && (
          <>
            <div className="text-5xl mb-4">⏳</div>
            <h1 className="text-xl font-bold text-white mb-2">Processando pagamento...</h1>
            <p className="text-gray-400 text-sm mb-6">
              Isso está demorando mais que o esperado. Se o pagamento foi concluído no Stripe,
              sua conta será ativada em instantes.
            </p>
            <button
              onClick={irParaDashboard}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-xl text-sm transition-all"
            >
              Acessar dashboard →
            </button>
            <p className="text-gray-600 text-xs mt-4">
              Se o dashboard não carregar, aguarde alguns minutos e tente fazer login.
            </p>
          </>
        )}

        {/* ── Erro ────────────────────────────────────────────────────── */}
        {status === 'erro' && (
          <>
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-white mb-2">Sessão expirada</h1>
            <p className="text-gray-400 text-sm mb-6">
              Faça login para acessar sua conta.
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-xl text-sm transition-all"
            >
              Fazer login
            </button>
          </>
        )}

      </div>

      {/* Garantias */}
      {(status === 'aguardando' || status === 'ativo') && (
        <div className="mt-8 flex items-center gap-6 text-xs text-gray-600">
          <span>🔒 Pagamento seguro</span>
          <span>✅ 7 dias grátis</span>
          <span>🛡️ Cancele quando quiser</span>
        </div>
      )}
    </div>
  )
}
