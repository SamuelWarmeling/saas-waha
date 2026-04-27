import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Flame, Plus, Pause, Play, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api'

const FuzzyGauge = ({ score }) => {
  const circ = 2 * Math.PI * 24
  const offset = circ - (score / 100) * circ
  const color = score > 60 ? 'text-success' : score > 30 ? 'text-warning' : 'text-destructive'
  return (
    <div className="relative h-14 w-14">
      <svg className="transform -rotate-90 w-14 h-14">
        <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-muted/50" />
        <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="3" fill="transparent"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" className={`${color} transition-all duration-1000`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-bold text-foreground/90">{score}</span>
    </div>
  )
}

export default function Aquecimento() {
  const [chips, setChips] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ session_id: '', dias_total: 21, msgs_inicio: 5, msgs_fim: 35 })
  const [saving, setSaving] = useState(false)
  const [antiBan, setAntiBan] = useState(null)

  const WARMUP_SCHEDULE = { 1: 20, 2: 36, 3: 65, 4: 117, 5: 210, 6: 378, 7: 500 }

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/aquecimento')
      setChips(Array.isArray(data) ? data : [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    api.get('/sessoes').then(r => setSessions(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    let mounted = true
    const poll = () => api.get('/antiban/status').then(r => { if (mounted) setAntiBan(r.data) }).catch(() => {})
    poll()
    const id = setInterval(poll, 60000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  async function createAquecimento() {
    if (!form.session_id) { toast.error('Selecione um chip'); return }
    setSaving(true)
    try {
      await api.post('/aquecimento', {
        session_id: parseInt(form.session_id),
        dias_total: form.dias_total,
        msgs_inicio: form.msgs_inicio,
        msgs_fim: form.msgs_fim,
      })
      toast.success('Aquecimento iniciado!')
      setShowCreate(false)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao iniciar aquecimento')
    }
    setSaving(false)
  }

  async function pausar(id) {
    try {
      await api.put(`/aquecimento/${id}/pausar`)
      toast.success('Aquecimento pausado')
      load()
    } catch { toast.error('Erro') }
  }

  async function retomar(id) {
    try {
      await api.put(`/aquecimento/${id}/retomar`)
      toast.success('Aquecimento retomado')
      load()
    } catch { toast.error('Erro') }
  }

  async function remover(id) {
    if (!window.confirm('Remover aquecimento?')) return
    try {
      await api.delete(`/aquecimento/${id}`)
      toast.success('Removido')
      load()
    } catch { toast.error('Erro') }
  }

  function getStatusInfo(chip) {
    const st = chip.status || 'ativo'
    if (st === 'concluido') return { label: 'Concluído', color: 'bg-success/10 text-success' }
    if (st === 'pausado') return { label: 'Pausado', color: 'bg-warning/10 text-warning' }
    if (st === 'cancelado') return { label: 'Cancelado', color: 'bg-destructive/10 text-destructive' }
    return { label: 'Ativo', color: 'bg-primary/10 text-primary' }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{chips.filter(c => c.status === 'ativo').length} chips em aquecimento</p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 glow-primary">
          <Plus className="h-4 w-4" /> Iniciar Aquecimento
        </button>
      </div>

      {loading ? (
        <div className="glass-card p-12 text-center text-muted-foreground text-sm">Carregando...</div>
      ) : chips.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Flame className="h-10 w-10 text-warning/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Nenhum chip em aquecimento.</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
            Iniciar aquecimento
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {chips.map((chip, i) => {
            const st = getStatusInfo(chip)
            const diaPct = chip.dia_atual && chip.dias_total ? Math.round((chip.dia_atual / chip.dias_total) * 100) : 0
            const msgPct = chip.msgs_hoje && chip.meta_hoje ? Math.round((chip.msgs_hoje / chip.meta_hoje) * 100) : 0
            return (
              <motion.div key={chip.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className={`glass-card p-5 ${chip.status === 'warning' ? 'risk-pulse' : ''}`}>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Flame className="h-4 w-4 text-warning" />
                      <span className="text-sm font-medium text-foreground/90">{chip.session_name || `Chip #${chip.id}`}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                    </div>
                    <p className="text-xs font-mono-data text-muted-foreground mt-0.5">{chip.phone_number || '—'}</p>
                  </div>
                  <FuzzyGauge score={chip.fuzzy_score ?? 0} />
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Progresso — Dia {chip.dia_atual ?? 0} de {chip.dias_total ?? 21}</span>
                    <span className="font-mono-data text-muted-foreground">{diaPct}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${diaPct}%`, boxShadow: '0 0 8px #9D4EDD' }} />
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Msgs hoje: {chip.msgs_hoje ?? 0} / {chip.meta_hoje ?? '—'}</span>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-success rounded-full" style={{ width: `${Math.min(100, msgPct)}%` }} />
                  </div>
                </div>

                {chip.ultimo_status_texto && (
                  <p className="text-xs text-muted-foreground mb-3 italic">{chip.ultimo_status_texto}</p>
                )}

                {chip.status === 'ativo' && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <span className="text-[9px] px-2 py-1 rounded-full bg-primary/10 text-primary font-semibold">
                      Simulacao humana
                    </span>
                    {chip.dia_atual && WARMUP_SCHEDULE[chip.dia_atual] && (
                      <span className="text-[9px] px-2 py-1 rounded-full bg-warning/10 text-warning font-semibold">
                        Dia {chip.dia_atual} — meta {WARMUP_SCHEDULE[chip.dia_atual]} msgs
                      </span>
                    )}
                    {antiBan?.ban_wave?.sistema_pausado && (
                      <span className="text-[9px] px-2 py-1 rounded-full bg-destructive/15 text-destructive font-semibold">
                        Pausado — onda de ban
                      </span>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  {chip.status === 'ativo' ? (
                    <button onClick={() => pausar(chip.id)} title="Pausar"
                      className="flex-1 h-8 rounded-lg bg-muted/50 border border-white/5 flex items-center justify-center text-warning hover:bg-warning/10 transition-colors gap-1 text-xs">
                      <Pause className="h-3.5 w-3.5" /> Pausar
                    </button>
                  ) : chip.status === 'pausado' ? (
                    <button onClick={() => retomar(chip.id)} title="Retomar"
                      className="flex-1 h-8 rounded-lg bg-muted/50 border border-white/5 flex items-center justify-center text-success hover:bg-success/10 transition-colors gap-1 text-xs">
                      <Play className="h-3.5 w-3.5" /> Retomar
                    </button>
                  ) : null}
                  <button onClick={() => remover(chip.id)} title="Remover"
                    className="h-8 px-3 rounded-lg bg-muted/50 border border-white/5 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Modal: Novo Aquecimento */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setShowCreate(false)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md glass-card p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-foreground/90">Iniciar Aquecimento</h2>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Chip *</label>
                <select value={form.session_id} onChange={e => setForm(f => ({ ...f, session_id: e.target.value }))}
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50">
                  <option value="">Selecione um chip</option>
                  {sessions.map(s => (
                    <option key={s.id} value={s.id}>{s.name} {s.phone_number ? `(${s.phone_number})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Duração (dias): {form.dias_total}</label>
                <input type="range" min="7" max="30" value={form.dias_total}
                  onChange={e => setForm(f => ({ ...f, dias_total: parseInt(e.target.value) }))}
                  className="w-full accent-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Msgs no início</label>
                  <input type="number" min="3" max="20" value={form.msgs_inicio}
                    onChange={e => setForm(f => ({ ...f, msgs_inicio: parseInt(e.target.value) }))}
                    className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Msgs no fim</label>
                  <input type="number" min="10" max="100" value={form.msgs_fim}
                    onChange={e => setForm(f => ({ ...f, msgs_fim: parseInt(e.target.value) }))}
                    className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreate(false)}
                className="flex-1 py-2.5 rounded-xl bg-muted text-foreground text-sm hover:bg-muted/80">
                Cancelar
              </button>
              <button onClick={createAquecimento} disabled={saving || !form.session_id}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Iniciando...' : 'Iniciar Aquecimento'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
