import { useEffect, useState, useCallback } from 'react'
import {
  MdAdd, MdRefresh, MdQrCode, MdDelete, MdCheckCircle, MdInfo, MdContentCopy,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

const STATUS_CONFIG = {
  connected: { label: 'Conectado', cls: 'badge-green' },
  connecting: { label: 'Conectando', cls: 'badge-yellow' },
  disconnected: { label: 'Desconectado', cls: 'badge-gray' },
  error: { label: 'Erro', cls: 'badge-red' },
}

function formatPhone(raw) {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4)
    const num = digits.slice(4)
    if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`
    if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`
  }
  return raw
}

function SessionIdBadge({ sessionId }) {
  const [copied, setCopied] = useState(false)

  function copy(e) {
    e.stopPropagation()
    navigator.clipboard.writeText(sessionId).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 rounded-md"
      style={{
        background: 'rgba(88,28,135,0.2)',
        border: '1px solid rgba(107,33,168,0.45)',
      }}
    >
      <span className="text-[10px] text-surface-500 select-none">ID:</span>
      <span className="font-mono text-[11px] text-primary-400 tracking-wide">{sessionId}</span>
      <button
        onClick={copy}
        title="Copiar ID"
        className="ml-0.5 transition-all duration-150 opacity-30 hover:opacity-100 hover:text-primary-400 text-surface-300 flex items-center"
      >
        {copied
          ? <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide">Copiado!</span>
          : <MdContentCopy size={12} />
        }
      </button>
    </div>
  )
}

export default function Sessoes() {
  const [sessions, setSessions] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [qrSession, setQrSession] = useState(null)
  const [form, setForm] = useState({ name: '' })

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/sessoes')
      setSessions(data)
    } catch {
      toast.error('Erro ao carregar sessões')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Polling de status para sessões conectando
  useEffect(() => {
    const connecting = sessions.filter(s => s.status === 'connecting')
    if (connecting.length === 0) return

    const interval = setInterval(async () => {
      for (const sess of connecting) {
        try {
          const { data } = await api.get(`/sessoes/${sess.id}/status`)
          if (data.status !== 'connecting') {
            load()
            if (data.status === 'connected') {
              toast.success(`Sessão "${sess.name}" conectada!`)
              setQrSession(null)
            } else if (data.status === 'error') {
              toast.error(`Sessão "${sess.name}" com erro`)
            } else if (data.status === 'disconnected') {
              toast(`Sessão "${sess.name}" desconectada`, { icon: '⚠️' })
            }
          }
        } catch { /* ignora */ }
      }
    }, 4000)

    return () => clearInterval(interval)
  }, [sessions, load])

  const update = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/sessoes', { name: form.name })
      toast.success('Sessão criada!')
      setShowModal(false)
      setForm({ name: '' })
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao criar sessão')
    } finally {
      setLoading(false)
    }
  }

  async function connect(sess) {
    try {
      const { data } = await api.post(`/sessoes/${sess.id}/conectar`)
      setQrSession({ id: sess.id, name: sess.name, qr: data.qr_code || null, status: 'connecting' })
      toast.success('Aguardando QR Code…')
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao conectar')
    }
  }

  // Auto-refresh QR a cada 5s até conectar
  useEffect(() => {
    if (!qrSession) return
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/sessoes/${qrSession.id}/qrcode`)
        if (data.status === 'connected') {
          setQrSession(null)
          toast.success(`Sessão "${qrSession.name}" conectada!`)
          load()
          return
        }
        setQrSession(prev => ({ ...prev, qr: data.qr, status: data.status }))
      } catch { /* ignora */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [qrSession, load])

  async function disconnect(id) {
    if (!confirm('Desconectar sessão?')) return
    try {
      await api.post(`/sessoes/${id}/desconectar`)
      toast.success('Sessão desconectada')
      load()
    } catch {
      toast.error('Erro ao desconectar')
    }
  }

  async function deleteSession(id) {
    if (!confirm('Deletar sessão permanentemente?')) return
    try {
      await api.delete(`/sessoes/${id}`)
      toast.success('Sessão deletada')
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao deletar')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Sessões WhatsApp</h1>
          <p className="text-sm text-surface-400 mt-1">Gerencie suas conexões de números</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={load} className="btn-secondary flex items-center gap-2 px-4 shadow-sm">
            <MdRefresh size={18} /> Atualizar
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 px-5">
            <MdAdd size={20} /> Nova Sessão
          </button>
        </div>
      </div>

      {/* Grid de sessões */}
      {sessions.length === 0 ? (
        <div className="glass-card text-center py-20 border-dashed border-2 border-surface-700 bg-surface-900/20">
          <div className="w-20 h-20 rounded-full bg-surface-800 flex items-center justify-center mx-auto mb-6 shadow-inner">
            <MdQrCode className="text-4xl text-surface-500" />
          </div>
          <p className="text-lg font-semibold text-surface-300">Nenhuma sessão criada</p>
          <p className="text-sm text-surface-500 mt-2 max-w-sm mx-auto">
            Para começar a enviar mensagens e extrair contatos, crie uma nova sessão e escaneie o QR Code com seu WhatsApp.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {sessions.map(sess => {
            const st = STATUS_CONFIG[sess.status] || STATUS_CONFIG.disconnected
            const pct = sess.max_daily_messages > 0
              ? Math.round((sess.messages_sent_today / sess.max_daily_messages) * 100) : 0
            const phoneFormatted = formatPhone(sess.phone_number)

            return (
              <div
                key={sess.id}
                className="glass-card space-y-5 p-0 overflow-hidden flex flex-col transition-all hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.3)] group"
              >
                {/* Header do card */}
                <div className={`p-6 border-b ${
                  sess.status === 'connected'
                    ? 'bg-primary-900/10 border-primary-900/30'
                    : sess.status === 'error'
                      ? 'bg-red-900/10 border-red-900/30'
                      : sess.status === 'connecting'
                        ? 'bg-amber-900/10 border-amber-900/30'
                        : 'bg-surface-900/30 border-surface-800/50'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1 pr-3">
                      {/* Nome */}
                      <h3 className="text-lg font-bold text-surface-100 group-hover:text-primary-300 transition-colors truncate">
                        {sess.name}
                      </h3>

                      {/* Telefone formatado ou status de conexão */}
                      <div className="mt-1.5">
                        {phoneFormatted ? (
                          <span
                            className="inline-flex items-center text-xs font-mono px-2 py-0.5 rounded"
                            style={{
                              background: 'rgba(11,9,20,0.5)',
                              border: '1px solid rgba(45,34,68,0.8)',
                              color: '#cbd5e1',
                            }}
                          >
                            {phoneFormatted}
                          </span>
                        ) : (
                          <span className="text-xs text-surface-500 italic">
                            {sess.status === 'connected' ? 'WhatsApp conectado' : 'Aguardando número'}
                          </span>
                        )}
                      </div>

                      {/* Badge tech do session_id com botão copiar */}
                      <SessionIdBadge sessionId={sess.session_id} />
                    </div>

                    <span className={`${st.cls} shadow-sm px-2.5 py-1 text-[11px] uppercase tracking-wider font-bold flex-shrink-0`}>
                      {st.label}
                    </span>
                  </div>
                </div>

                <div className="p-6 pt-2 flex-1 space-y-5">
                  {/* Barra de limite diário */}
                  <div className="bg-surface-900/40 rounded-xl p-3.5 border border-surface-800/60 shadow-inner">
                    <div className="flex justify-between text-xs text-surface-400 font-medium mb-2">
                      <span className="flex items-center gap-1.5">
                        <div className="w-1 h-3 rounded-full bg-primary-500"></div>
                        Disparos hoje
                      </span>
                      <span><strong className="text-surface-200">{sess.messages_sent_today}</strong> / {sess.max_daily_messages}</span>
                    </div>
                    <div className="w-full bg-surface-950 rounded-full h-2 overflow-hidden border border-surface-800 shadow-inner">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ease-out relative ${
                          pct >= 90
                            ? 'bg-red-500 shadow-[0_0_10px_theme(colors.red.500)]'
                            : 'bg-gradient-to-r from-primary-600 to-primary-400 shadow-[0_0_10px_theme(colors.primary.500/50)]'
                        }`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      >
                        <div className="absolute top-0 left-0 w-full h-full bg-white/20"></div>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Ações */}
                <div className="p-4 bg-surface-900/50 border-t border-surface-700/50 flex gap-3">
                  {sess.status === 'disconnected' || sess.status === 'error' ? (
                    <button
                      onClick={() => connect(sess)}
                      className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm py-2.5 shadow-lg shadow-primary-900/20"
                    >
                      <MdQrCode size={18} /> Conectar
                    </button>
                  ) : sess.status === 'connected' ? (
                    <button
                      onClick={() => disconnect(sess.id)}
                      className="btn-secondary flex-1 text-sm py-2.5 hover:bg-red-900/20 hover:text-red-400 hover:border-red-500/30 transition-all border border-transparent"
                    >
                      Desconectar
                    </button>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center py-1">
                      <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                        Aguardando QR Code
                      </div>
                      <div className="text-[10px] text-surface-500 mt-0.5">Clique em conectar novamente se demorar</div>
                    </div>
                  )}
                  <button
                    onClick={() => deleteSession(sess.id)}
                    className="p-2.5 rounded-xl bg-surface-800 hover:bg-red-900/30 text-surface-500 hover:text-red-400 transition-all border border-surface-700 hover:border-red-500/30 shadow-sm"
                    title="Excluir sessão"
                  >
                    <MdDelete size={18} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal QR Code */}
      {qrSession && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="glass-card w-full max-w-sm p-0 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border-surface-600/50 animate-[slideIn_0.3s_ease-out] text-center">
            <div className="px-6 py-5 border-b border-surface-700/50 bg-surface-900/80">
              <h2 className="text-lg font-bold text-white flex items-center justify-center gap-2">
                <MdQrCode className="text-primary-400" size={22} />
                Conectar Sessão
              </h2>
              <p className="text-sm text-surface-400 mt-1 font-medium">{qrSession.name}</p>
            </div>

            <div className="p-8">
              <p className="text-xs text-surface-400 mb-6 bg-surface-800/50 p-3 rounded-lg border border-surface-700/50 text-left leading-relaxed">
                1. Abra o WhatsApp no celular<br />
                2. Toque em <strong>Menu</strong> ou <strong>Configurações</strong><br />
                3. Selecione <strong>Aparelhos conectados</strong><br />
                4. Toque em <strong>Conectar aparelho</strong>
              </p>

              {qrSession.status === 'connected' ? (
                <div className="w-[240px] h-[240px] mx-auto bg-primary-900/20 border border-primary-500/30 rounded-2xl flex flex-col items-center justify-center gap-4 relative overflow-hidden shadow-inner">
                  <div className="absolute inset-0 bg-gradient-to-t from-primary-500/10 to-transparent"></div>
                  <div className="w-20 h-20 rounded-full bg-primary-500/20 flex items-center justify-center relative z-10 shadow-[0_0_20px_theme(colors.primary.500/30)]">
                    <MdCheckCircle className="text-5xl text-primary-400" />
                  </div>
                  <p className="text-primary-300 font-bold text-lg relative z-10">Conectado com sucesso!</p>
                </div>
              ) : qrSession.qr ? (
                <div className="relative inline-block">
                  <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-primary-700 blur-xl opacity-20 rounded-2xl"></div>
                  <img
                    key={qrSession.qr}
                    src={qrSession.qr}
                    alt="QR Code"
                    className="relative mx-auto rounded-2xl border-4 border-surface-800 bg-white p-3 shadow-2xl"
                    width={240}
                    height={240}
                  />
                </div>
              ) : (
                <div className="w-[240px] h-[240px] mx-auto bg-surface-900/50 border border-surface-700/50 rounded-2xl flex flex-col items-center justify-center gap-4 shadow-inner">
                  <div className="w-12 h-12 border-4 border-surface-700 border-t-primary-500 rounded-full animate-spin" />
                  <p className="text-surface-400 text-sm font-medium">Gerando QR Code...</p>
                </div>
              )}

              <p className="text-[11px] font-medium text-surface-500 mt-6 flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse"></span>
                Atualiza automaticamente a cada 5 segundos
              </p>
            </div>

            <div className="p-4 border-t border-surface-700/50 bg-surface-900/30">
              <button
                onClick={() => { setQrSession(null); load() }}
                className="btn-secondary w-full py-2.5 font-medium"
              >
                Fechar janela
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nova Sessão */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="glass-card w-full max-w-md p-0 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border-surface-600/50 animate-[slideIn_0.3s_ease-out]">
            <div className="px-6 py-5 border-b border-surface-700/50 bg-surface-900/50">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
                  <MdAdd size={20} />
                </div>
                Nova Sessão
              </h2>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-5">
              <div>
                <label className="label">Nome de identificação</label>
                <input
                  name="name" value={form.name} onChange={update}
                  placeholder="Ex: Atendimento Comercial" required className="input"
                />
                <p className="text-[11px] font-medium text-surface-500 mt-1.5 ml-1 flex items-center gap-1">
                  <MdInfo size={12} className="text-surface-400" />
                  Um ID técnico será gerado automaticamente para esta sessão
                </p>
              </div>

              <div className="flex gap-3 pt-4 border-t border-surface-700/50 mt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1 py-2.5">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn-primary flex-1 py-2.5">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Criando...
                    </span>
                  ) : 'Criar Sessão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
