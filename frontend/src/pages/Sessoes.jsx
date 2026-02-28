import { useEffect, useState, useCallback } from 'react'
import { MdAdd, MdRefresh, MdQrCode, MdDelete, MdCheckCircle, MdError } from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

const STATUS_CONFIG = {
  connected:    { label: 'Conectado',    cls: 'badge-green'  },
  connecting:   { label: 'Conectando',   cls: 'badge-yellow' },
  disconnected: { label: 'Desconectado', cls: 'badge-gray'   },
  error:        { label: 'Erro',         cls: 'badge-red'    },
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
      await api.post(`/sessoes/${sess.id}/conectar`)
      setQrSession({ id: sess.id, name: sess.name, qr: null, status: 'connecting' })
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Sessões WhatsApp</h1>
          <p className="text-sm text-gray-500">Gerencie suas conexões</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary flex items-center gap-2">
            <MdRefresh /> Atualizar
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <MdAdd /> Nova Sessão
          </button>
        </div>
      </div>

      {/* Grid de sessões */}
      {sessions.length === 0 ? (
        <div className="card text-center py-12">
          <MdQrCode className="text-5xl text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">Nenhuma sessão criada.</p>
          <p className="text-gray-600 text-sm mt-1">Crie uma sessão e escaneie o QR Code.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sessions.map(sess => {
            const st = STATUS_CONFIG[sess.status] || STATUS_CONFIG.disconnected
            const pct = sess.max_daily_messages > 0
              ? Math.round((sess.messages_sent_today / sess.max_daily_messages) * 100) : 0

            return (
              <div key={sess.id} className="card space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-white">{sess.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {sess.phone_number || 'Sem número'}
                    </p>
                    <p className="text-xs text-gray-600 font-mono mt-0.5">
                      ID: {sess.session_id}
                    </p>
                  </div>
                  <span className={st.cls}>{st.label}</span>
                </div>

                {/* Daily limit */}
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Disparos hoje</span>
                    <span>{sess.messages_sent_today}/{sess.max_daily_messages}</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${pct >= 90 ? 'bg-red-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="text-xs text-gray-600">
                  Delay: {sess.delay_min}–{sess.delay_max}s entre mensagens
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  {sess.status === 'disconnected' || sess.status === 'error' ? (
                    <button
                      onClick={() => connect(sess)}
                      className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm py-2"
                    >
                      <MdQrCode /> Conectar
                    </button>
                  ) : sess.status === 'connected' ? (
                    <button
                      onClick={() => disconnect(sess.id)}
                      className="btn-secondary flex-1 text-sm py-2"
                    >
                      Desconectar
                    </button>
                  ) : (
                    <div className="flex-1 text-center text-xs text-yellow-400 py-2 animate-pulse">
                      Aguardando QR…
                    </div>
                  )}
                  <button
                    onClick={() => deleteSession(sess.id)}
                    className="p-2 rounded-lg hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <MdDelete />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* QR Code Modal */}
      {qrSession && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm text-center">
            <h2 className="text-lg font-bold text-white mb-2">
              Conectar — {qrSession.name}
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo
            </p>

            {qrSession.status === 'connected' ? (
              <div className="w-[250px] h-[250px] mx-auto bg-green-900/30 rounded-xl flex flex-col items-center justify-center gap-3">
                <MdCheckCircle className="text-5xl text-green-400" />
                <p className="text-green-300 font-medium">Conectado!</p>
              </div>
            ) : qrSession.qr ? (
              <img
                key={qrSession.qr}
                src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrSession.qr)}&size=250x250&bgcolor=111827&color=22c55e`}
                alt="QR Code"
                className="mx-auto rounded-xl border border-gray-700"
                width={250}
                height={250}
              />
            ) : (
              <div className="w-[250px] h-[250px] mx-auto bg-gray-800 rounded-xl flex flex-col items-center justify-center gap-3">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-500" />
                <p className="text-gray-500 text-sm">Aguardando QR…</p>
              </div>
            )}

            <p className="text-xs text-gray-600 mt-4 animate-pulse">
              Atualiza automaticamente a cada 5 segundos
            </p>
            <button
              onClick={() => { setQrSession(null); load() }}
              className="btn-secondary w-full mt-4"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Modal Nova Sessão */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md">
            <h2 className="text-lg font-bold text-white mb-5">Nova Sessão</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="label">Nome da sessão</label>
                <input
                  name="name" value={form.name} onChange={update}
                  placeholder="Ex: Número Principal" required className="input"
                />
                <p className="text-xs text-gray-600 mt-1">O ID da sessão será gerado automaticamente (ex: u1_01)</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Delay mínimo (s)</label>
                  <input type="number" name="delay_min" value={form.delay_min}
                    onChange={update} min={1} max={60} className="input" />
                </div>
                <div>
                  <label className="label">Delay máximo (s)</label>
                  <input type="number" name="delay_max" value={form.delay_max}
                    onChange={update} min={1} max={120} className="input" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">
                  {loading ? 'Criando...' : 'Criar Sessão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
