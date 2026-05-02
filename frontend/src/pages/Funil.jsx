import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, GripVertical, X, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api'

const STAGE_COLORS = {
  frio:       { color: 'border-blue-500/30',   bg: 'from-blue-500/20 to-blue-500/5',   emoji: '🧊', label: 'Frio' },
  morno:      { color: 'border-yellow-500/30', bg: 'from-yellow-500/20 to-yellow-500/5', emoji: '🌡️', label: 'Morno' },
  quente:     { color: 'border-orange-500/30', bg: 'from-orange-500/20 to-orange-500/5', emoji: '🔥', label: 'Quente' },
  convertido: { color: 'border-green-500/30',  bg: 'from-green-500/20 to-green-500/5',  emoji: '✅', label: 'Convertido' },
}

export default function Funil() {
  const [sequencias, setSequencias] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ nome: '', descricao: '' })
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(null)

  // Organiza sequências em colunas por estágio
  const columns = Object.entries(STAGE_COLORS).map(([id, cfg]) => ({
    id,
    ...cfg,
    sequencias: sequencias.filter(s => (s.estagio || 'frio') === id),
  }))

  const load = useCallback(async () => {
    try {
      const [seqRes, statsRes] = await Promise.all([
        api.get('/funil/sequencias').catch(() => ({ data: [] })),
        api.get('/funil/stats').catch(() => ({ data: null })),
      ])
      setSequencias(Array.isArray(seqRes.data) ? seqRes.data : [])
      setStats(statsRes.data)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  async function createSequencia() {
    if (!form.nome.trim()) { toast.error('Nome obrigatório'); return }
    setSaving(true)
    try {
      await api.post('/funil/sequencias', { nome: form.nome.trim(), descricao: form.descricao })
      toast.success('Sequência criada!')
      setShowCreate(false)
      setForm({ nome: '', descricao: '' })
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao criar sequência')
    }
    setSaving(false)
  }

  async function moveSequencia(seqId, toEstagio) {
    if (!dragging) return
    try {
      await api.put(`/funil/sequencias/${seqId}`, { estagio: toEstagio })
      setSequencias(prev => prev.map(s => s.id === seqId ? { ...s, estagio: toEstagio } : s))
    } catch {}
    setDragging(null)
  }

  async function deleteSequencia(id) {
    if (!window.confirm('Remover esta sequência?')) return
    try {
      await api.delete(`/funil/sequencias/${id}`)
      toast.success('Sequência removida')
      load()
    } catch { toast.error('Erro ao remover') }
  }

  async function iniciarSequencia(id) {
    try {
      await api.post(`/funil/sequencias/${id}/iniciar`)
      toast.success('Sequência iniciada!')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao iniciar')
    }
  }

  // Stats cards
  const funnelStats = [
    { stage: '🧊 Frio',       count: sequencias.filter(s => (s.estagio || 'frio') === 'frio').length,       color: 'from-blue-500/20 to-blue-500/5' },
    { stage: '🌡️ Morno',     count: sequencias.filter(s => s.estagio === 'morno').length,                    color: 'from-yellow-500/20 to-yellow-500/5' },
    { stage: '🔥 Quente',     count: sequencias.filter(s => s.estagio === 'quente').length,                   color: 'from-orange-500/20 to-orange-500/5' },
    { stage: '✅ Convertido', count: sequencias.filter(s => s.estagio === 'convertido').length,               color: 'from-green-500/20 to-green-500/5' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Arraste as sequências entre as colunas</p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 glow-primary">
          <Plus className="h-4 w-4" /> Nova Sequência
        </button>
      </div>

      {/* Stats resumo */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {funnelStats.map((f, i) => (
            <div key={i} className={`glass-card p-4 bg-gradient-to-b ${f.color} border border-white/5 text-center`}>
              <p className="text-lg mb-1">{f.stage.split(' ')[0]}</p>
              <p className="text-xs text-muted-foreground">{f.stage.split(' ').slice(1).join(' ')}</p>
              <p className="text-2xl font-bold font-mono-data text-foreground/90 mt-1">{f.count}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="glass-card p-12 text-center text-muted-foreground text-sm">Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 min-h-[50vh]">
          {columns.map(col => (
            <div key={col.id}
              onDragOver={e => e.preventDefault()}
              onDrop={() => dragging && moveSequencia(dragging, col.id)}
              className={`glass-card p-4 border-t-2 ${col.color}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-foreground/90">{col.emoji} {col.label}</h3>
                <span className="text-xs font-mono-data text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full">
                  {col.sequencias.length}
                </span>
              </div>
              <div className="space-y-2">
                {col.sequencias.length === 0 && (
                  <div className="text-center py-6 text-xs text-muted-foreground/50">
                    Arraste aqui
                  </div>
                )}
                {col.sequencias.map((seq, i) => (
                  <motion.div key={seq.id} draggable
                    onDragStart={() => setDragging(seq.id)}
                    onDragEnd={() => setDragging(null)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="p-3 rounded-xl bg-muted/20 border border-white/5 cursor-grab active:cursor-grabbing hover:bg-muted/30 transition-colors">
                    <div className="flex items-start gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground/30 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground/90 truncate">{seq.nome}</p>
                        {seq.descricao && <p className="text-xs text-muted-foreground truncate">{seq.descricao}</p>}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-muted-foreground font-mono-data">
                            {seq.total_contatos ?? 0} contatos
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 mt-2">
                      <button onClick={() => iniciarSequencia(seq.id)}
                        className="flex-1 h-6 rounded-lg bg-primary/10 text-primary text-xs flex items-center justify-center gap-1 hover:bg-primary/20 transition-colors">
                        <Play className="h-3 w-3" /> Iniciar
                      </button>
                      <button onClick={() => deleteSequencia(seq.id)}
                        className="h-6 w-6 rounded-lg bg-muted/50 text-muted-foreground flex items-center justify-center hover:text-destructive hover:bg-muted transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Nova Sequência */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setShowCreate(false)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md glass-card p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-foreground/90">Nova Sequência</h2>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nome *</label>
                <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex: Follow-up Black Friday"
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                  autoFocus />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Descrição</label>
                <textarea value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  placeholder="Descrição opcional..."
                  rows={3}
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreate(false)}
                className="flex-1 py-2.5 rounded-xl bg-muted text-foreground text-sm hover:bg-muted/80">
                Cancelar
              </button>
              <button onClick={createSequencia} disabled={saving || !form.nome.trim()}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Criando...' : 'Criar Sequência'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
