import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, QrCode, Flame, Pause, Trash2, WifiOff, RotateCcw, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api'

const FuzzyGauge = ({ score }) => {
  const circumference = 2 * Math.PI * 28
  const offset = circumference - (score / 100) * circumference
  const color = score > 60 ? 'text-success' : score > 30 ? 'text-warning' : 'text-destructive'
  return (
    <div className="relative h-16 w-16">
      <svg className="transform -rotate-90 w-16 h-16">
        <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-muted/50" />
        <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className={`${color} transition-all duration-1000 ease-out`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-bold text-foreground/90">{score}</span>
    </div>
  )
}

function getStatusKey(s) {
  const st = (s.status || '').toLowerCase()
  if (['connected', 'working'].includes(st)) return 'online'
  if (['qr', 'scan_qr_code', 'starting'].includes(st)) return 'attention'
  return 'offline'
}

const statusConfig = {
  online:    { label: 'Online',  color: 'bg-success/10 text-success',     dot: 'bg-success pulse-online' },
  offline:   { label: 'Offline', color: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  attention: { label: 'Atenção', color: 'bg-warning/10 text-warning',     dot: 'bg-warning' },
}

export default function Sessoes() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [qrModal, setQrModal] = useState(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [antiBan, setAntiBan] = useState(null)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/sessoes')
      setSessions(Array.isArray(data) ? data : [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    let mounted = true
    const poll = () => api.get('/antiban/status').then(r => { if (mounted) setAntiBan(r.data) }).catch(() => {})
    poll()
    const id = setInterval(poll, 30000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  function getAntiBanForChip(chip) {
    if (!antiBan) return { score: 0, paused: null, reconnects: 0 }
    const sid = chip.session_id || chip.name
    const score = antiBan.health_monitor?.scores?.[sid] ?? 0
    const paused = antiBan.circuit_breaker?.chips_pausados?.find(c => c.session_id === sid) ?? null
    const reconnects = antiBan.circuit_breaker?.reconexoes_ultima_hora?.[sid] ?? 0
    return { score, paused, reconnects }
  }

  async function createSession() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await api.post('/sessoes', { name: newName.trim() })
      toast.success('Sessão criada!')
      setNewName('')
      setShowCreate(false)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao criar sessão')
    }
    setCreating(false)
  }

  async function connectSession(chip) {
    try {
      const { data } = await api.post(`/sessoes/${chip.id}/conectar`)
      setQrModal({ id: chip.id, name: chip.name, qr_code: data.qr_code })
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao conectar')
    }
  }

  async function disconnectSession(id) {
    try {
      await api.post(`/sessoes/${id}/desconectar`)
      toast.success('Sessão desconectada')
      load()
    } catch {}
  }

  async function deleteSession(id) {
    if (!window.confirm('Remover esta sessão?')) return
    try {
      await api.delete(`/sessoes/${id}`)
      toast.success('Sessão removida')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao remover')
    }
  }

  const onlineCount = sessions.filter(s => getStatusKey(s) === 'online').length

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{onlineCount} de {sessions.length} chips conectados</p>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors glow-primary">
          <Plus className="h-4 w-4" /> Nova Sessão
        </button>
      </div>

      {loading ? (
        <div className="glass-card p-12 text-center text-muted-foreground text-sm">Carregando...</div>
      ) : sessions.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-muted-foreground text-sm">Nenhuma sessão criada ainda.</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
            Criar primeira sessão
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {sessions.map((chip, i) => {
            const stKey = getStatusKey(chip)
            const st = statusConfig[stKey]
            const score = chip.fuzzy_score ?? 0
            const risk = chip.risco ?? 0
            const ab = getAntiBanForChip(chip)
            return (
              <motion.div
                key={chip.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileHover={{ y: -4, borderColor: 'rgba(157,78,221,0.4)' }}
                className={`glass-card p-5 ${risk > 60 && risk < 100 ? 'risk-pulse' : ''}`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-sm font-medium text-foreground/90">{chip.name}</p>
                    <p className="text-xs font-mono-data text-muted-foreground mt-0.5">
                      {chip.phone_number || 'Aguardando conexão'}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${st.color}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                    {st.label}
                  </span>
                </div>

                <div className="flex items-center gap-4 mb-4">
                  <FuzzyGauge score={score} />
                  <div className="space-y-1.5 text-xs">
                    <p className="text-muted-foreground">Tipo: <span className="text-foreground/80">{chip.tipo_chip === 'virtual' ? 'Virtual' : 'Físico'}</span></p>
                    <p className="text-muted-foreground">Msgs hoje: <span className="font-mono-data text-foreground/80">{chip.messages_sent_today ?? 0}</span></p>
                    <p className="text-muted-foreground">Máx/dia: <span className="font-mono-data text-foreground/80">{chip.max_daily_messages ?? '—'}</span></p>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Risco de ban</span>
                    <span className="font-mono-data text-muted-foreground">{risk}%</span>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${risk > 60 ? 'bg-destructive' : risk > 30 ? 'bg-warning' : 'bg-success'}`}
                      style={{ width: `${risk}%` }} />
                  </div>
                </div>

                {(ab.score > 0 || ab.paused || ab.reconnects > 0) && (
                  <div className="mb-4 px-2.5 py-2 rounded-xl bg-muted/20 border border-white/5">
                    <div className="flex items-center gap-1 mb-2">
                      <ShieldCheck className="h-3 w-3 text-muted-foreground" />
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Anti-Ban Live</p>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className={`rounded-lg py-1.5 ${ab.score >= 85 ? 'bg-destructive/15' : ab.score >= 60 ? 'bg-warning/15' : ab.score >= 30 ? 'bg-yellow-500/10' : 'bg-success/10'}`}>
                        <p className={`text-[12px] font-bold ${ab.score >= 85 ? 'text-destructive' : ab.score >= 60 ? 'text-warning' : ab.score >= 30 ? 'text-yellow-400' : 'text-success'}`}>{ab.score}</p>
                        <p className="text-[9px] text-muted-foreground">Health</p>
                      </div>
                      <div className={`rounded-lg py-1.5 ${ab.paused ? 'bg-destructive/15' : 'bg-success/10'}`}>
                        <p className={`text-[12px] font-bold ${ab.paused ? 'text-destructive' : 'text-success'}`}>{ab.paused ? `${ab.paused.minutos_restantes}m` : 'OK'}</p>
                        <p className="text-[9px] text-muted-foreground">Circuit</p>
                      </div>
                      <div className="rounded-lg py-1.5 bg-muted/30">
                        <p className="text-[12px] font-bold text-muted-foreground">{ab.reconnects}</p>
                        <p className="text-[9px] text-muted-foreground">Reconex/h</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => connectSession(chip)} title="Conectar / QR Code"
                    className="flex-1 h-8 rounded-lg bg-muted/50 border border-white/5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <QrCode className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => disconnectSession(chip.id)} title="Desconectar"
                    className="flex-1 h-8 rounded-lg bg-muted/50 border border-white/5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <WifiOff className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={load} title="Atualizar"
                    className="flex-1 h-8 rounded-lg bg-muted/50 border border-white/5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteSession(chip.id)} title="Remover"
                    className="flex-1 h-8 rounded-lg bg-muted/50 border border-white/5 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Modal: Nova Sessão */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setShowCreate(false)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md glass-card p-8"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-foreground/90 mb-2">Nova Sessão</h2>
            <p className="text-sm text-muted-foreground mb-6">Crie uma nova sessão do WhatsApp</p>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createSession()}
              placeholder="Nome da sessão (ex: Chip 01)"
              className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setShowCreate(false)}
                className="flex-1 py-2 rounded-xl bg-muted text-foreground text-sm hover:bg-muted/80 transition-colors">
                Cancelar
              </button>
              <button onClick={createSession} disabled={creating || !newName.trim()}
                className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                {creating ? 'Criando...' : 'Criar Sessão'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal: QR Code */}
      {qrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setQrModal(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md glass-card p-8 text-center"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-foreground/90 mb-2">Conectar: {qrModal.name}</h2>
            <p className="text-sm text-muted-foreground mb-6">Escaneie o QR Code com seu WhatsApp</p>
            {qrModal.qr_code ? (
              <img src={qrModal.qr_code} alt="QR Code" className="mx-auto rounded-xl border border-white/10" style={{ maxWidth: 220 }} />
            ) : (
              <div className="h-48 w-48 mx-auto bg-muted/50 rounded-xl border border-white/10 flex items-center justify-center">
                <QrCode className="h-24 w-24 text-muted-foreground/30" />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-4">Aguardando leitura do QR Code...</p>
            <button onClick={() => setQrModal(null)}
              className="mt-6 px-6 py-2 rounded-xl bg-muted text-foreground text-sm hover:bg-muted/80 transition-colors">
              Fechar
            </button>
          </motion.div>
        </div>
      )}
    </div>
  )
}
