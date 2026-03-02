import { useEffect, useState, useCallback } from 'react'
import { MdAdd, MdRefresh, MdQrCode, MdDelete, MdCheckCircle, MdError, MdInfo } from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

const STATUS_CONFIG = {
  connected: { label: 'Conectado', cls: 'badge-green' },
  connecting: { label: 'Conectando', cls: 'badge-yellow' },
  disconnected: { label: 'Desconectado', cls: 'badge-gray' },
  error: { label: 'Erro', cls: 'badge-red' },
}

export default function Sessoes() {
  const [sessions, setSessions] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [qrSession, setQrSession] = useState(null) // { id, name, qr, status }
  const [form, setForm] = useState({ name: '', delay_min: 5, delay_max: 15 })

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
      await api.post('/sessoes', {
        ...form,
        delay_min: Number(form.delay_min),
        delay_max: Number(form.delay_max),
      })
      toast.success('Sessão criada!')
      setShowModal(false)
      setForm({ name: '', delay_min: 5, delay_max: 15 })
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
          <p className="text-sm text-surface-500 mt-2 max-w-sm mx-auto">Para começar a enviar mensagens e extrair contatos, crie uma nova sessão e escaneie o QR Code com seu WhatsApp.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {sessions.map(sess => {
            const st = STATUS_CONFIG[sess.status] || STATUS_CONFIG.disconnected
            const pct = sess.max_daily_messages > 0
              ? Math.round((sess.messages_sent_today / sess.max_daily_messages) * 100) : 0

            return (
              <div key={sess.id} className="glass-card space-y-5 p-0 overflow-hidden flex flex-col transition-all hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.3)] group border-surface-700/50 hover:border-surface-600">
                <div className={`p-6 border-b ${sess.status === 'connected' ? 'bg-primary-900/10 border-primary-900/30' : sess.status === 'error' ? 'bg-red-900/10 border-red-900/30' : sess.status === 'connecting' ? 'bg-amber-900/10 border-amber-900/30' : 'bg-surface-900/30 border-surface-800/50'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-surface-100 group-hover:text-primary-300 transition-colors">{sess.name}</h3>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs font-mono bg-surface-950 px-2 py-0.5 rounded border border-surface-800 text-surface-300 shadow-inner">
                          {sess.phone_number || 'Sem número'}
                        </span>
                      </div>
                      <p className="text-[11px] text-surface-500 font-mono mt-2 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-surface-600"></span> ID: {sess.session_id}
                      </p>
                    </div>
                    <span className={`${st.cls} shadow-sm px-2.5 py-1 text-[11px] uppercase tracking-wider font-bold`}>{st.label}</span>
                  </div>
                </div>

                <div className="p-6 pt-2 flex-1 space-y-5">
                  {/* Daily limit */}
                  <div className="bg-surface-900/40 rounded-xl p-3.5 border border-surface-800/60 shadow-inner">
                    <div className="flex justify-between text-xs text-surface-400 font-medium mb-2">
                      <span className="flex items-center gap-1.5"><div className="w-1 h-3 rounded-full bg-primary-500"></div> Disparos hoje</span>
                      <span><strong className="text-surface-200">{sess.messages_sent_today}</strong> / {sess.max_daily_messages}</span>
                    </div>
                    <div className="w-full bg-surface-950 rounded-full h-2 overflow-hidden border border-surface-800 shadow-inner">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ease-out relative ${pct >= 90 ? 'bg-red-500 shadow-[0_0_10px_theme(colors.red.500)]' : 'bg-gradient-to-r from-primary-600 to-primary-400 shadow-[0_0_10px_theme(colors.primary.500/50)]'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      >
                        <div className="absolute top-0 left-0 w-full h-full bg-white/20"></div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-medium text-surface-400 bg-surface-800/30 py-2 px-3 rounded-lg border border-surface-700/30">
                    <span className="uppercase tracking-wider">Delay Configurado</span>
                    <span className="text-surface-200 bg-surface-900 px-2 py-0.5 rounded shadow-inner border border-surface-800">{sess.delay_min}s – {sess.delay_max}s</span>
                  </div>
                </div>

                {/* Actions */}
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

      {/* QR Code Modal */}
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
              <p className="text-xs text-surface-400 mb-6 bg-surface-800/50 p-3 rounded-lg border border-surface-700/50">
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
                  <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-purple-500 blur-xl opacity-20 rounded-2xl"></div>
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
                  ID interno gerado automaticamente (ex: u1_01)
                </p>
              </div>

              <div className="bg-surface-900/30 p-4 rounded-xl border border-surface-800/50">
                <h3 className="text-sm font-semibold text-surface-200 mb-3 flex items-center gap-2">
                  <div className="w-1.5 h-4 rounded-full bg-primary-500"></div>
                  Configuração de Delay
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Mínimo (seg)</label>
                    <input type="number" name="delay_min" value={form.delay_min}
                      onChange={update} min={1} max={60} className="input text-center" />
                  </div>
                  <div>
                    <label className="label">Máximo (seg)</label>
                    <input type="number" name="delay_max" value={form.delay_max}
                      onChange={update} min={1} max={120} className="input text-center" />
                  </div>
                </div>
                <p className="text-[11px] text-surface-500 mt-3 text-center">Tempo aleatório aguardado entre cada mensagem enviada para evitar bloqueios.</p>
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
