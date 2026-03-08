import { useEffect, useState, useCallback } from 'react'
import {
  MdAdd, MdRefresh, MdQrCode, MdDelete, MdCheckCircle, MdInfo, MdContentCopy,
  MdPhoneAndroid, MdComputer,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

// ── Gauge de Score Fuzzy ───────────────────────────────────────────────────────
function ScoreGauge({ diag }) {
  if (!diag) return null
  const { score, label, razao } = diag
  const color = label === 'HIGH' ? '#22c55e' : label === 'MED' ? '#f59e0b' : label === 'OFFLINE' || label === 'BLOCKED' ? '#6b7280' : '#ef4444'
  const bg    = label === 'HIGH' ? 'rgba(34,197,94,0.08)'   : label === 'MED' ? 'rgba(245,158,11,0.08)'  : label === 'OFFLINE' || label === 'BLOCKED' ? 'rgba(107,114,128,0.08)' : 'rgba(239,68,68,0.08)'
  const bdr   = label === 'HIGH' ? 'rgba(34,197,94,0.2)'    : label === 'MED' ? 'rgba(245,158,11,0.2)'   : label === 'OFFLINE' || label === 'BLOCKED' ? 'rgba(107,114,128,0.2)'  : 'rgba(239,68,68,0.2)'

  // SVG arc: circunferência = 2πr ≈ 100 para r=15.9155
  const dash = `${score} 100`

  return (
    <div title={razao}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl"
      style={{ background: bg, border: `1px solid ${bdr}` }}>
      {/* Mini gauge circular */}
      <svg width="32" height="32" viewBox="0 0 36 36">
        {/* Trilha de fundo */}
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none" stroke="#1e1e2e" strokeWidth="3.5"
        />
        {/* Arco do score */}
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={dash} strokeLinecap="round"
        />
        <text x="18" y="20.5" textAnchor="middle"
          style={{ fontSize: '8px', fontWeight: 900, fill: color }}>
          {score}
        </text>
      </svg>
      {/* Label */}
      <div>
        <p className="text-[11px] font-black leading-none" style={{ color }}>
          {label === 'OFFLINE' ? 'OFFLINE' : label === 'BLOCKED' ? 'BLOQ.' : label}
        </p>
        <p className="text-[9px] text-surface-500 mt-0.5 max-w-[80px] truncate leading-none" title={razao}>{razao}</p>
      </div>
    </div>
  )
}

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
  const [diagnosticos, setDiagnosticos] = useState({})
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [qrSession, setQrSession] = useState(null)
  const [form, setForm] = useState({ name: '' })

  const load = useCallback(async () => {
    try {
      const [sessRes, diagRes] = await Promise.allSettled([
        api.get('/sessoes'),
        api.get('/chips/diagnostico'),
      ])
      if (sessRes.status === 'fulfilled') setSessions(sessRes.value.data)
      if (diagRes.status === 'fulfilled') {
        const map = {}
        for (const d of diagRes.value.data) map[d.session_id] = d
        setDiagnosticos(map)
      }
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

  async function toggleTipoChip(sess) {
    const novo = sess.tipo_chip === 'virtual' ? 'fisico' : 'virtual'
    try {
      await api.patch(`/sessoes/${sess.id}/tipo-chip`, { tipo_chip: novo })
      toast.success(`Chip definido como ${novo === 'virtual' ? '💻 Virtual' : '📱 Físico'}`)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao alterar tipo')
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

                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={`${st.cls} shadow-sm px-2.5 py-1 text-[11px] uppercase tracking-wider font-bold`}>
                        {st.label}
                      </span>
                      {/* Aquecido badge */}
                      {sess.is_aquecido && !sess.is_veterano && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold"
                          style={{ background: 'rgba(234,179,8,0.15)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.3)' }}>
                          🔥 Aquecido
                        </span>
                      )}
                      {/* Veterano badge */}
                      {sess.is_veterano && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold"
                          style={{ background: 'rgba(234,179,8,0.2)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.4)' }}>
                          ⭐ Veterano
                        </span>
                      )}
                      {/* Em adaptação badge */}
                      {sess.em_adaptacao && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold"
                          style={{ background: 'rgba(157,78,221,0.12)', color: '#c4b5fd', border: '1px solid rgba(157,78,221,0.3)' }}>
                          ⏳ Em adaptação
                        </span>
                      )}
                      {/* Chip type toggle */}
                      <button
                        onClick={() => toggleTipoChip(sess)}
                        title={sess.tipo_chip === 'virtual'
                          ? 'Chip Virtual: só responde mensagens. Clique para mudar para Físico.'
                          : 'Chip Físico: inicia conversas. Clique para mudar para Virtual.'}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold transition-all ${
                          sess.tipo_chip === 'virtual'
                            ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25'
                            : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                        }`}
                      >
                        {sess.tipo_chip === 'virtual'
                          ? <><MdComputer size={13} /> 💻 Virtual</>
                          : <><MdPhoneAndroid size={13} /> 📱 Físico</>
                        }
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-6 pt-2 flex-1 space-y-5">
                  {/* Recomendação de limite */}
                  {sess.em_adaptacao ? (
                    <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                      style={{ background: 'rgba(157,78,221,0.08)', border: '1px solid rgba(157,78,221,0.2)' }}>
                      <span>⏳</span>
                      <span className="text-purple-300 font-medium">Em adaptação — disparos em massa bloqueados</span>
                    </div>
                  ) : sess.is_veterano ? (
                    <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                      style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }}>
                      <span>⭐</span>
                      <span className="text-yellow-300 font-medium">Chip veterano — limite recomendado: <strong>150 msgs/dia</strong></span>
                    </div>
                  ) : sess.is_aquecido ? (
                    <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                      style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
                      <span>🔥</span>
                      <span className="text-yellow-400 font-medium">Chip aquecido — limite recomendado: <strong>100 msgs/dia</strong></span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                      style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                      <span>⚠️</span>
                      <span className="text-red-400/80 font-medium">Não aquecido — limite recomendado: <strong>30 msgs/dia</strong></span>
                    </div>
                  )}

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

                  {/* Score Fuzzy */}
                  <ScoreGauge diag={diagnosticos[sess.id]} />

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
